const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { preparePopular, applyPopular, validatePlan, totals } = require('../server/popular-import.cjs');
const { ADMIN_UID } = require('../server/policy.cjs');
const { media } = require('../server/tmdb-model.cjs');
const { movie, tv } = require('./fixtures/tmdb.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const date = '2026-10-28', jobId = 'popular-20261028-aaaaaaaaaaaa';
const storeFor = db => createCatalogueStore({ getFirestore: async () => db, now: () => '2026-10-28T10:00:00.000Z' });
function planFor() {
  const items = [];
  for (const [category, count] of [['Film', 20], ['Série', 20], ['Anime', 10]]) {
    for (let n = 0; n < count; n++) {
      const type = category === 'Film' ? 'movie' : 'tv', id = 100000 + items.length;
      const item = media(type === 'movie' ? { ...movie, id } : { ...tv, id }, type);
      item.isAnime = category === 'Anime';
      const episodes = [
        { number: 1, season: 1, tmdbId: id * 10 + 1, title: 'Diffusé', airdate: '2020-01-01' },
        { number: 2, season: 1, tmdbId: id * 10 + 2, title: 'Futur', airdate: '2027-01-01' },
        { number: 3, season: 1, tmdbId: id * 10 + 3, title: 'Date inconnue', airdate: '' }
      ];
      items.push({ category, item, popularity: 100 - n, aliases: [], seasons: type === 'movie' ? [] : [{ number: 1, guide: { episodes } }] });
    }
  }
  return { schema: 1, jobId, date, existingIds: [], items };
}

test('import populaire : sélection classée, doublons/adultes/futurs exclus et alias répétés préservés', async () => {
  const entries = [
    { ...movie, id: 101, popularity: 1 }, { ...movie, id: 102, popularity: 20 },
    { ...movie, id: 103, popularity: 10 }, { ...movie, id: 104, popularity: 100, adult: true },
    { ...movie, id: 105, popularity: 200, release_date: '2027-01-01' }
  ];
  const plan = await preparePopular({ date, groups: [{ category: 'Film', type: 'movie', count: 2 }], existing: [{ id: 'tmdb-movie-101' }],
    legacy: [{ id: 'movie-tt102', imageSource: 'https://www.themoviedb.org/movie/102' }, { id: 'movie-tt103', imageSource: 'https://www.themoviedb.org/movie/103' }].values(),
    client: { get: async () => ({ data: { total_pages: 1, results: entries }, stale: false }) },
    tmdb: { details: async (_, id) => ({ item: media(entries.find(x => x.id === id), 'movie'), stale: false }) }
  });
  assert.deepEqual(plan.items.map(x => x.item.tmdbId), [102, 103]);
  assert.deepEqual(plan.items.map(x => x.aliases[0]), ['movie-tt102', 'movie-tt103']);
});

test('import populaire : 50 nouveaux titres, seuls épisodes diffusés publiés, aucune vidéo créée', async () => {
  const db = createTestFirestore(), store = storeFor(db), plan = validatePlan(planFor());
  const old = await store.create(media({ ...movie, id: 999 }, 'movie'), 'Film', ADMIN_UID);
  await store.patch(old.id, old.version, ADMIN_UID, { status: 'hidden', editor: { title: 'Mon choix existant' } });
  const original = JSON.stringify([...db.data]);
  const completed = [];
  await applyPopular({ plan, store, uid: ADMIN_UID, completed });
  assert.equal(completed.length, 50); assert.equal(totals(plan).airedEpisodes, 30);
  for (const record of plan.items) {
    const state = await store.get(record.item.id);
    assert.equal(state.entry.status, 'published'); assert.equal(state.entry.video, undefined);
    assert.equal(state.entry.importJobId, jobId);
    if (record.seasons.length) {
      const guide = await store.season(state.entry.id, 1);
      assert.deepEqual(guide.episodes.map(e => e.published), [true, false, false]);
      assert.equal(guide.season.publishedEpisodes, 1); assert.equal(guide.season.published, true);
      assert.equal((await store.publicSeason(state.entry.id, 1)).episodes.length, 1);
    }
    assert.equal((await store.publicGet(state.entry.id)).importJobId, undefined);
  }
  const originals = [...db.data].filter(([key]) => key.includes(old.id));
  assert.equal(JSON.stringify(originals), original);
  const before = JSON.stringify([...db.data]);
  await applyPopular({ plan, store, uid: ADMIN_UID, completed });
  assert.equal(JSON.stringify([...db.data]), before);
});

test('import populaire : reprise après interruption sans doublons ni republication des choix manuels', async () => {
  const db = createTestFirestore(), store = storeFor(db), plan = planFor(), completed = [];
  let calls = 0;
  const interrupted = { ...store, create: async (...args) => { if (++calls === 4) throw Error('Réseau simulé'); return store.create(...args); } };
  await assert.rejects(applyPopular({ plan, store: interrupted, uid: ADMIN_UID, completed }));
  assert.equal(completed.length, 3);
  let state = await store.get(completed[0]); await store.patch(state.entry.id, state.entry.version, ADMIN_UID, { status: 'hidden' });
  await applyPopular({ plan, store, uid: ADMIN_UID, completed });
  assert.equal((await store.get(completed[0])).entry.status, 'hidden');
  assert.equal((await db.collection('catalogueEntries').get()).size, 50);
});

test('import populaire : collision existante et rôle non autorisé refusés sans écrasement', async () => {
  const db = createTestFirestore(), store = storeFor(db), plan = planFor();
  await assert.rejects(applyPopular({ plan, store, uid: 'regular' }), error => error.code === 'IMPORT_OWNER_REQUIRED');
  const first = plan.items[0]; await store.create(first.item, first.category, ADMIN_UID);
  const before = JSON.stringify([...db.data]);
  await assert.rejects(applyPopular({ plan, store, uid: ADMIN_UID }), error => error.code === 'IMPORT_EXISTING_ENTRY_PRESERVED');
  assert.equal(JSON.stringify([...db.data]), before);
  const duplicate = planFor(); duplicate.items[1] = duplicate.items[0];
  assert.throws(() => validatePlan(duplicate), error => error.code === 'IMPORT_INVALID_PLAN');
});

test('import populaire : validation en lot réservée aux nouveaux brouillons de la tâche', async () => {
  const db = createTestFirestore(), store = storeFor(db);
  const item = media(tv, 'tv'), guide = { episodes: [{ number: 1, tmdbId: 1, airdate: '2020-01-01' }] };
  const old = await store.create(item, 'Série', ADMIN_UID);
  const approval = { publishAiredThrough: date, importJobId: jobId };
  await assert.rejects(store.importSeason(old.id, old.version, ADMIN_UID, 1, guide, approval), e => e.code === 'CATALOGUE_IMPORT_JOB_REJECTED');
  const entry = await store.create({ ...item, id: 'tmdb-tv-888', tmdbId: 888 }, 'Série', ADMIN_UID, { importJobId: jobId });
  await assert.rejects(store.importSeason(entry.id, entry.version, 'regular', 1, guide, approval), e => e.code === 'CATALOGUE_IMPORT_JOB_REJECTED');
  await assert.rejects(store.importSeason(entry.id, entry.version, ADMIN_UID, 1, guide, { ...approval, publishAiredThrough: '2099-01-01' }), e => e.code === 'CATALOGUE_IMPORT_JOB_REJECTED');
  let state = await store.importSeason(entry.id, entry.version, ADMIN_UID, 1, guide);
  assert.equal((await store.season(entry.id, 1)).episodes[0].published, false);
  state = await store.importSeason(entry.id, state.entry.version, ADMIN_UID, 1, guide, approval);
  assert.equal((await store.season(entry.id, 1)).episodes[0].published, false, 'Un choix existant false est préservé.');
});
