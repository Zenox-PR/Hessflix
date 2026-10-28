// Explicit, owner-authorized catalogue population. Never used by public routes.
const { randomBytes } = require('node:crypto');
const { HttpError, ADMIN_UID } = require('./policy.cjs');
const model = require('./catalogue-model.cjs');
const { isAnime } = require('./tmdb-model.cjs');

const GROUPS = Object.freeze([
  { category: 'Film', type: 'movie', count: 20 },
  { category: 'Série', type: 'tv', count: 20 },
  { category: 'Anime', type: 'tv', count: 10 }
]);
const aired = (date, cutoff) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && date <= cutoff;

function aliasesFor(item, legacy = []) {
  return [...legacy].filter(value => value.id === 'movie-' + item.imdbId || value.imageSource === `https://www.themoviedb.org/${item.mediaType}/${item.tmdbId}`).map(value => value.id);
}

async function preparePopular({ client, tmdb, existing = [], legacy = [], date, groups = GROUPS, progress = () => {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new HttpError(400, 'IMPORT_INVALID_DATE');
  const known = new Set(existing.map(entry => entry.id));
  const existingAliases = new Set(existing.flatMap(entry => entry.aliases || []));
  const legacyItems = [...legacy];
  async function fresh(work) {
    for (let attempt = 0; ; attempt++) {
      try { return await work(); }
      catch (error) {
        if (attempt >= 2 || ![429, 502, 503].includes(error.status)) throw error;
        progress({ stage: 'tmdb-retry', attempt: attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, Math.max(500 * (attempt + 1), Math.min(300, error.retryAfter || 0) * 1000)));
      }
    }
  }
  const plan = { schema: 1, jobId: 'popular-' + date.replaceAll('-', '') + '-' + randomBytes(6).toString('hex'), date, createdAt: new Date().toISOString(), existingIds: [...known], items: [] };
  for (const group of groups) {
    const pool = new Map();
    for (let page = 1; page <= 3; page++) {
      const filters = group.type === 'movie' ? { 'primary_release_date.lte': date, include_video: false } : { 'first_air_date.lte': date, include_null_first_air_dates: false };
      if (group.category === 'Anime') Object.assign(filters, { with_genres: '16', with_original_language: 'ja' });
      else if (group.type === 'tv') Object.assign(filters, { without_genres: '16' });
      const response = await fresh(() => client.get('/discover/' + group.type, { language: 'fr-FR', include_adult: false, sort_by: 'popularity.desc', page, ...filters }));
      if (response.stale || !Array.isArray(response.data.results)) throw new HttpError(503, 'IMPORT_TMDB_UNAVAILABLE');
      for (const value of response.data.results) {
        const id = Number.isSafeInteger(value.id) && value.id > 0 ? model.canonical(group.type, value.id) : '';
        const released = value.release_date || value.first_air_date;
        if (!id || known.has(id) || value.adult || !aired(released, date) || (group.category === 'Anime' ? !isAnime(value) : isAnime(value))) continue;
        if (!pool.has(id)) pool.set(id, value);
      }
      if (page >= (response.data.total_pages || 1)) break;
    }
    const candidates = [...pool.values()].sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0) || a.id - b.id);
    let count = 0;
    for (const raw of candidates) {
      if (count === group.count) break;
      let detail;
      try { detail = await fresh(() => tmdb.details(group.type, raw.id, true)); }
      catch (error) { if (error.status === 404) continue; throw error; }
      if (detail.stale || !detail.item || !aired(detail.item.releaseDate, date)) continue;
      if (group.category === 'Anime' ? !detail.item.isAnime : detail.item.isAnime) continue;
      const aliases = aliasesFor(detail.item, legacyItems);
      if (aliases.some(alias => existingAliases.has(alias))) continue;
      const record = { category: group.category, popularity: Number(raw.popularity) || 0, item: detail.item, aliases, seasons: [] };
      progress({ stage: 'prepare-title', category: group.category, title: detail.item.title, number: plan.items.length + 1 });
      if (group.type === 'tv') {
        for (const descriptor of detail.item.tmdbSeasons || []) {
          if (descriptor.episodes === 0 || (descriptor.airdate && !aired(descriptor.airdate, date))) continue;
          const guide = await fresh(() => tmdb.seasonDetails(detail.item.tmdbId, descriptor.number, true));
          if (guide.stale || !Array.isArray(guide.episodes)) throw new HttpError(503, 'IMPORT_TMDB_UNAVAILABLE');
          // Unknown/future dates remain private; keep their metadata for manual use.
          if (!guide.episodes.some(episode => aired(episode.airdate, date))) continue;
          record.seasons.push({ number: descriptor.number, guide });
          progress({ stage: 'prepare-season', title: detail.item.title, season: descriptor.number, episodes: guide.episodes.length });
        }
        if (!record.seasons.length) continue;
      }
      plan.items.push(record); known.add(detail.item.id); count++;
    }
    if (count !== group.count) throw new HttpError(503, 'IMPORT_NOT_ENOUGH_ELIGIBLE_TITLES');
  }
  return plan;
}

function validatePlan(plan) {
  if (plan?.schema !== 1 || !/^popular-\d{8}-[a-f0-9]{12}$/.test(plan.jobId || '') || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date || '') || !Array.isArray(plan.items) || plan.items.length !== 50 || !Array.isArray(plan.existingIds)) throw new HttpError(400, 'IMPORT_INVALID_PLAN');
  const ids = new Set();
  for (const record of plan.items) {
    const id = model.canonical(record.item?.mediaType, record.item?.tmdbId);
    if (id !== record.item.id || ids.has(id) || plan.existingIds.includes(id) || !aired(record.item.releaseDate, plan.date) || !Array.isArray(record.seasons)) throw new HttpError(400, 'IMPORT_INVALID_PLAN');
    model.category(record.category, record.item.mediaType); ids.add(id);
    const seen = new Set();
    for (const season of record.seasons) {
      if (!Number.isSafeInteger(season.number) || season.number < 0 || seen.has(season.number) || !Array.isArray(season.guide?.episodes) || !season.guide.episodes.some(episode => aired(episode.airdate, plan.date))) throw new HttpError(400, 'IMPORT_INVALID_PLAN');
      seen.add(season.number);
    }
  }
  for (const group of GROUPS) if (plan.items.filter(item => item.category === group.category).length !== group.count) throw new HttpError(400, 'IMPORT_INVALID_PLAN');
  return plan;
}

function totals(plan) {
  return { titles: plan.items.length, movies: plan.items.filter(x => x.category === 'Film').length, series: plan.items.filter(x => x.category === 'Série').length, anime: plan.items.filter(x => x.category === 'Anime').length,
    seasons: plan.items.reduce((sum, x) => sum + x.seasons.length, 0),
    episodes: plan.items.reduce((sum, x) => sum + x.seasons.reduce((n, s) => n + s.guide.episodes.length, 0), 0),
    airedEpisodes: plan.items.reduce((sum, x) => sum + x.seasons.reduce((n, s) => n + s.guide.episodes.filter(e => aired(e.airdate, plan.date)).length, 0), 0) };
}

async function applyPopular({ plan, store, uid, progress = () => {}, completed = [], checkpoint = () => {} }) {
  validatePlan(plan);
  if (uid !== ADMIN_UID) throw new HttpError(403, 'IMPORT_OWNER_REQUIRED');
  for (const record of plan.items) {
    const id = record.item.id;
    if (completed.includes(id)) continue;
    let state;
    try { state = await store.get(id); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!state) {
      await store.create(record.item, record.category, uid, { aliases: record.aliases, platforms: [], importJobId: plan.jobId });
      state = await store.get(id);
    }
    if (state.entry.importJobId !== plan.jobId) throw new HttpError(409, 'IMPORT_EXISTING_ENTRY_PRESERVED');
    if (state.entry.status === 'published') { completed.push(id); checkpoint(completed); continue; }
    if (state.entry.status !== 'draft') throw new HttpError(409, 'IMPORT_MANUAL_STATUS_PRESERVED');
    progress({ stage: 'import-title', title: record.item.title, completed: completed.length, total: plan.items.length });
    for (const season of record.seasons) {
      if (state.seasons.some(value => value.number === season.number && value.complete && !value.importError)) continue;
      state = await store.importSeason(id, state.entry.version, uid, season.number, season.guide, { publishAiredThrough: plan.date, importJobId: plan.jobId });
      progress({ stage: 'import-season', title: record.item.title, season: season.number });
    }
    await store.patch(id, state.entry.version, uid, { status: 'published' });
    completed.push(id); checkpoint(completed);
    progress({ stage: 'published', id, title: record.item.title, completed: completed.length, total: plan.items.length });
  }
  return { completed, ...totals(plan) };
}

module.exports = { preparePopular, applyPopular, validatePlan, totals, aired, aliasesFor, GROUPS };
