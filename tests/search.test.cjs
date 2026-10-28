const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const { media } = require('../server/tmdb-model.cjs');
const browser = require('../catalogue-model.js');
const { movie } = require('./fixtures/tmdb.cjs');
const { ADMIN_UID } = require('../server/policy.cjs');
async function add(store, id, title, extra = {}, editor = {}) {
  const entry = await store.create({ ...media({ ...movie, id, title }, 'movie'), ...extra }, 'Film', ADMIN_UID);
  return store.patch(entry.id, entry.version, ADMIN_UID, { status: 'published', editor });
}
test('recherche : serveur et interface cohérents sur lettre, fragments, accents et ponctuation', async () => {
  const db = createTestFirestore(), catalogue = createCatalogueStore({ getFirestore: async () => db });
  const state = await add(catalogue, 100001, 'Échos : l’aventure — Mission impossible', { originalTitle: 'Echoes', alternativeTitles: ['Un titre alternatif très long ' + 'x'.repeat(250) + ' Retrouvable'] });
  for (const query of ['a', 'chos', 'ECHOS', 'l aventure', 'mission impossible', 'Echoes', 'Retrouvable']) {
    const remote = await catalogue.publicPage({ query }); assert.equal(remote.items.length, 1, query);
    assert.equal(browser.filterItems([await catalogue.publicGet(state.entry.id)], { query, kind: 'Tous' }).length, 1, query);
  }
  assert.equal((await catalogue.publicPage({ query: 'inexistant' })).items.length, 0);
});
test('recherche : filtres combinés et publications seules, sans index composé supplémentaire', async () => {
  const db = createTestFirestore(), store = createCatalogueStore({ getFirestore: async () => db });
  await add(store, 100001, 'Échos', { genres: ['Animation'], isAnime: true }, { category: 'Anime', platforms: ['netflix'] });
  await add(store, 100002, 'Échos film', {}, { platforms: ['disney'] });
  const secret = await store.create(media({ ...movie, id: 100003, title: 'Échos secret' }, 'movie'), 'Film', ADMIN_UID);
  assert.equal(secret.status, 'draft');
  assert.equal((await store.publicPage({ query: 'chos', kind: 'Anime', provider: 'netflix' })).items.length, 1);
  assert.equal((await store.publicPage({ query: 'chos', kind: 'Anime', provider: 'disney' })).items.length, 0);
  assert.equal((await store.publicPage({ query: 'chos', kind: 'Animation' })).items.length, 1);
  assert.equal((await store.publicPage({ query: 'secret' })).items.length, 0);
});
test('recherche : lecture bornée et curseur sans perte après 200 métadonnées parcourues', async () => {
  const db = createTestFirestore(), store = createCatalogueStore({ getFirestore: async () => db, now: () => '2026-10-28T10:00:00Z' });
  for (let i = 0; i < 240; i++) await add(store, 100000 + i, i >= 230 ? 'Cible ' + i : 'Autre ' + i);
  const first = await store.publicPage({ query: 'Cible', limit: 3 });
  assert.equal(first.items.length, 0); assert.ok(first.nextCursor);
  const second = await store.publicPage({ query: 'Cible', limit: 3, after: first.nextCursor });
  assert.equal(second.items.length, 3); assert.ok(second.nextCursor);
  const all = [...second.items]; let cursor = second.nextCursor;
  while (cursor) { const page = await store.publicPage({ query: 'Cible', limit: 3, after: cursor }); all.push(...page.items); cursor = page.nextCursor; }
  assert.equal(new Set(all.map(x => x.id)).size, 10);
});
