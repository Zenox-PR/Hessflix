const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./policy.cjs');
const { createRateLimiter } = require('./rate-limit.cjs');
const { createTMDBClient } = require('./tmdb-client.cjs');
const model = require('./tmdb-model.cjs');
function legacyCatalogue(root) {
  const result = new Map();
  for (const file of ['discovery-data.js', 'platform-catalogue-data.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const data = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
    for (const item of data.items) if (typeof item.id === 'string') result.set(item.id, item);
  }
  return result;
}
function createTMDBRoutes({ root, client = createTMDBClient(), now = () => new Date() } = {}) {
  const limit = createRateLimiter(); let catalogue;
  const base = { language: 'fr-FR', include_adult: 'false' };
  function send(response, status, body, extra = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); response.end(JSON.stringify(body));
  }
  function checkQuery(url, allowed) {
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new HttpError(400, 'TMDB_INVALID_QUERY');
  }
  async function genres(type) {
    const { data } = await client.get(`/genre/${type}/list`, { language: 'fr-FR' }, 86400000);
    return Object.fromEntries((Array.isArray(data.genres) ? data.genres : []).filter(genre => Number.isInteger(genre.id) && typeof genre.name === 'string').map(genre => [genre.id, genre.name]));
  }
  async function details(type, id, refresh = false) {
    if (refresh) client.invalidate?.(`/${type}/${id}`);
    const response = await client.get(`/${type}/${id}`, { language: 'fr-FR', append_to_response: 'external_ids,alternative_titles,keywords' }, 21600000);
    let data = response.data, stale = response.stale, fallback = false;
    if (!model.text(data.overview) || !model.text(data.title || data.name)) {
      try {
        const english = await client.get(`/${type}/${id}`, { language: 'en-US' }, 21600000);
        fallback = !model.text(data.overview) && !!model.text(english.data.overview);
        data = { ...english.data, ...data, title: model.text(data.title) || english.data.title, name: model.text(data.name) || english.data.name, overview: model.text(data.overview) || english.data.overview };
        stale ||= english.stale;
      } catch { /* Conserver les données françaises et originales déjà disponibles. */ }
    }
    const item = model.media(data, type); if (!item) throw new HttpError(404, 'TMDB_NOT_FOUND');
    if (fallback) item.metadataLanguage = 'en-US';
    return { item, stale };
  }
  async function resolve(id) {
    catalogue ||= legacyCatalogue(root);
    const item = catalogue.get(id); if (!item) throw new HttpError(404, 'TMDB_NOT_FOUND');
    const direct = /^https:\/\/www\.themoviedb\.org\/(movie|tv)\/(\d+)$/.exec(item.imageSource || '');
    if (direct) return { mediaType: direct[1], tmdbId: Number(direct[2]) };
    const imdb = /^movie-(tt\d+)$/.exec(id);
    if (imdb) {
      const { data } = await client.get(`/find/${imdb[1]}`, { ...base, external_source: 'imdb_id' }, 86400000);
      if (data.movie_results?.length === 1) return { mediaType: 'movie', tmdbId: data.movie_results[0].id };
      throw new HttpError(404, 'TMDB_MATCH_UNCERTAIN');
    }
    const type = item.kind === 'Film' ? 'movie' : 'tv';
    const { data } = await client.get(`/search/${type}`, { ...base, query: item.title, page: '1' });
    const matches = (data.results || []).filter(candidate => candidate.adult !== true && model.normalise(candidate.title || candidate.name) === model.normalise(item.title) && (candidate.release_date || candidate.first_air_date || '').slice(0, 4) === item.year);
    if (matches.length !== 1 || data.total_pages > 1) throw new HttpError(404, 'TMDB_MATCH_UNCERTAIN');
    return { mediaType: type, tmdbId: matches[0].id };
  }
  async function handle(request, response, url) {
    try {
      if (request.method !== 'GET') { send(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' }); return; }
      limit(request, 'tmdb', 100, 600);
      const route = url.pathname.slice('/api/tmdb/'.length);
      if (route === 'status') { checkQuery(url, []); send(response, 200, { configured: client.configured() }); return; }
      if (!client.configured()) throw new HttpError(503, 'TMDB_NOT_CONFIGURED');
      let result;
      const detail = /^detail\/(movie|tv)\/([1-9]\d{0,8})$/.exec(route);
      const season = /^season\/([1-9]\d{0,8})\/(\d{1,4})$/.exec(route);
      if (detail) { checkQuery(url, []); result = await details(detail[1], Number(detail[2])); }
      else if (season) {
        checkQuery(url, []);
        const { data, stale } = await client.get(`/tv/${season[1]}/season/${Number(season[2])}`, { language: 'fr-FR' }, 21600000);
        let merged = data;
        if (data.episodes?.some(episode => !model.text(episode.name) || !model.text(episode.overview))) {
          try {
            const english = await client.get(`/tv/${season[1]}/season/${Number(season[2])}`, { language: 'en-US' }, 21600000);
            merged = { ...data, episodes: data.episodes.map(episode => { const other = english.data.episodes?.find(value => value.episode_number === episode.episode_number); return { ...other, ...episode, name: model.text(episode.name) || other?.name, overview: model.text(episode.overview) || other?.overview }; }) };
          } catch { /* Les épisodes sans traduction restent consultables. */ }
        }
        result = { ...model.season(merged, Number(season[2])), stale };
      } else if (route === 'resolve') {
        checkQuery(url, ['id']); const id = url.searchParams.get('id') || '';
        if (!/^(?:movie-tt\d+|series-\d+|jw-(?:tm|ts)\d+)$/.test(id) || id.length > 60) throw new HttpError(400, 'TMDB_INVALID_ID');
        result = await resolve(id);
      } else if (route === 'search' || route === 'browse') {
        checkQuery(url, route === 'search' ? ['query', 'category', 'page', 'year'] : ['section', 'category', 'page']);
        const category = url.searchParams.get('category') || 'Tous';
        if (!['Tous', 'Film', 'Série', 'Anime', 'Animation', 'Documentaire'].includes(category)) throw new HttpError(400, 'TMDB_INVALID_CATEGORY');
        const page = url.searchParams.get('page') || '1'; if (!/^[1-9]\d{0,2}$/.test(page) || Number(page) > 500) throw new HttpError(400, 'TMDB_INVALID_PAGE');
        const types = category === 'Film' ? ['movie'] : category === 'Série' ? ['tv'] : ['movie', 'tv'];
        const query = (url.searchParams.get('query') || '').trim();
        const year=url.searchParams.get('year')||'';if(year&&!/^(18|19|20|21)\d{2}$/.test(year))throw new HttpError(400,'TMDB_INVALID_QUERY');
        if (route === 'search' && (query.length < 2 || query.length > 150 || /[\x00-\x1f]/.test(query))) throw new HttpError(400, 'TMDB_INVALID_QUERY');
        const section = url.searchParams.get('section') || 'trending';
        if (route === 'browse' && !['trending', 'popular', 'recent'].includes(section)) throw new HttpError(400, 'TMDB_INVALID_SECTION');
        const responses = await Promise.all(types.map(async type => {
          let pathname, params = { ...base, page };
          if (route === 'search') { pathname = `/search/${type}`; params.query = query;if(year)params[type==='movie'?'year':'first_air_date_year']=year; }
          else if (category === 'Anime' || category === 'Animation' || category === 'Documentaire' || section === 'recent') {
            pathname = `/discover/${type}`; params.sort_by = 'popularity.desc';
            if (category === 'Anime' || category === 'Animation') params.with_genres = '16';
            if (category === 'Anime') params.with_original_language = 'ja';
            if (category === 'Documentaire') params.with_genres = '99';
            if (section === 'recent') {
              const today = now().toISOString().slice(0, 10), since = new Date(now().getTime() - 90 * 86400000).toISOString().slice(0, 10);
              params[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = since;
              params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;
              if (type === 'movie') params.region = 'FR';
            }
          } else pathname = section === 'trending' ? `/trending/${type}/week` : `/${type}/popular`;
          const [response, names] = await Promise.all([client.get(pathname, params), genres(type)]);
          if (!Array.isArray(response.data.results)) throw new HttpError(502, 'TMDB_INVALID_RESPONSE');
          const entries = response.data.results.map(entry => model.media(entry, type, names)).filter(Boolean).filter(entry => category !== 'Anime' || entry.isAnime).filter(entry => category !== 'Animation' || entry.genres.includes(names[16])).filter(entry => category !== 'Documentaire' || entry.genres.includes(names[99]));
          return { items: entries, totalPages: Math.min(500, Number(response.data.total_pages) || 1), stale: response.stale };
        }));
        result = { items: [...new Map(responses.flatMap(value => value.items).map(item => [item.id, item])).values()], page: Number(page), totalPages: Math.max(...responses.map(value => value.totalPages)), stale: responses.some(value => value.stale) };
      } else throw new HttpError(404, 'TMDB_NOT_FOUND');
      send(response, 200, result);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      send(response, status, { code: error instanceof HttpError ? error.code : 'TMDB_INVALID_RESPONSE' }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  }
  async function seasonDetails(id, number, refresh = false) {
    const pathname=`/tv/${id}/season/${number}`;
    if(refresh)client.invalidate?.(pathname);
    const result=await client.get(pathname,{language:'fr-FR'},21600000);
    let data=result.data;
    if(data.episodes?.some(episode=>!model.text(episode.name)||!model.text(episode.overview))) {
      try {const english=await client.get(pathname,{language:'en-US'},21600000);data={...data,episodes:data.episodes.map(episode=>{const fallback=english.data.episodes?.find(value=>value.episode_number===episode.episode_number);return {...episode,name:model.text(episode.name)||fallback?.name||'',overview:model.text(episode.overview)||fallback?.overview||''};})};} catch { /* Garder les informations existantes. */ }
    }
    return {...model.season(data,number),stale:result.stale};
  }
  async function images(type, id) {
    if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'TMDB_INVALID_ID');
    const result = await client.get(`/${type}/${id}/images`, { include_image_language: 'fr,en,null' }, 21600000);
    return [...new Set((Array.isArray(result.data.backdrops) ? result.data.backdrops : [])
      .filter(image => typeof image.file_path === 'string' && /^\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(image.file_path))
      .slice(0, 18).map(image => 'https://image.tmdb.org/t/p/w1280' + image.file_path))];
  }
  return { handle, details, resolve, seasonDetails, images, configured:client.configured };
}
function legacyCollections(root){
  const values=new Map();for(const file of ['discovery-data.js','platform-catalogue-data.js']){const source=fs.readFileSync(path.join(root,file),'utf8');const data=JSON.parse(source.slice(source.indexOf('{'),source.lastIndexOf('}')+1));for(const collection of data.collections||[])values.set(collection.id,collection);}return values;
}
module.exports = { createTMDBRoutes, legacyCatalogue, legacyCollections };
