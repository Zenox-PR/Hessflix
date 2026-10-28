const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTick } = require('node:timers/promises');
const { createAdminRoutes } = require('../server/admin-routes.cjs');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const { media } = require('../server/tmdb-model.cjs');
const { tv } = require('./fixtures/tmdb.cjs');

const admin = createAdminRoutes({
  origin: 'http://localhost:4180',
  getAuth() { throw new Error('This body-parser test must not call Firebase.'); }
});

function requestChunks(chunks, contentType = 'application/json') {
  return {
    headers: { 'content-type': contentType },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        await nextTick();
        yield chunk;
      }
    }
  };
}

test('régression UTF-8 : accents et emojis découpés à chaque octet restent intacts', async () => {
  const expected = { title: 'Été à Noël — Cinéma 🎬', overview: 'L’épisode préféré : 🧑🏽‍🚀' };
  const encoded = Buffer.from(JSON.stringify(expected));
  const chunks = Array.from(encoded, (_, index) => encoded.subarray(index, index + 1));
  assert.deepEqual(await admin.body(requestChunks(chunks), encoded.length), expected);
});

test('régression UTF-8 : limite exacte en octets, dépassement 413 et JSON invalide', async () => {
  const encoded = Buffer.from(JSON.stringify({ title: 'Été 🎬' }));
  assert.deepEqual(await admin.body(requestChunks([encoded]), encoded.length), { title: 'Été 🎬' });
  await assert.rejects(
    admin.body(requestChunks([encoded.subarray(0, 4), encoded.subarray(4)]), encoded.length - 1),
    error => error.status === 413 && error.code === 'BODY_TOO_LARGE'
  );
  await assert.rejects(admin.body(requestChunks([Buffer.from('{broken')])), error => error.status === 400);
  await assert.rejects(
    admin.body(requestChunks([Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d])])),
    error => error.code === 'INVALID_JSON'
  );
});

function episode(number, tmdbId = 500 + number) {
  return { number, tmdbId, season: 1, title: 'Épisode ' + number, overview: 'Résumé', airdate: '2020-01-01', runtime: 25 };
}

async function fixture() {
  const db = createTestFirestore();
  const store = createCatalogueStore({ getFirestore: async () => db, now: () => '2026-10-26T00:00:00.000Z' });
  const entry = await store.create(media(tv, 'tv'), 'Série', 'test-admin');
  const state = await store.importSeason(entry.id, entry.version, 'test-admin', 1, { episodes: [episode(1), episode(2)] });
  return { db, store, id: entry.id, state };
}

test('régression épisodes : un brouillon disparu devient obsolète et ne peut plus être publié', async () => {
  const { store, id, state } = await fixture();
  const updated = await store.importSeason(id, state.entry.version, 'test-admin', 1, { episodes: [episode(1)] });
  const missing = (await store.season(id, 1)).episodes.find(value => value.number === 2);
  assert.equal(missing.obsolete, true);
  assert.equal(missing.obsoleteReason, 'missing-from-tmdb');
  assert.equal(missing.obsoleteAt, '2026-10-26T00:00:00.000Z');
  assert.deepEqual(missing.meta, episode(2));
  await assert.rejects(
    store.patchEpisode(id, updated.entry.version, 'test-admin', 1, 2, { published: true }),
    error => error.code === 'CATALOGUE_EPISODE_OBSOLETE' && error.status === 409
  );
});

test('régression épisodes : corrections et publications absentes sont conservées, masquage permis', async () => {
  const { store, id, state } = await fixture();
  let saved = await store.patchEpisode(id, state.entry.version, 'test-admin', 1, 2, {
    published: true,
    editor: { title: 'Mon titre corrigé', overview: 'Mon résumé 🎬' }
  });
  saved = await store.patchSeason(id, saved.entry.version, 'test-admin', 1, { published: true });
  saved = await store.patch(id, saved.entry.version, 'test-admin', { status: 'published' });
  saved = await store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [episode(1)] });
  const missing = (await store.season(id, 1)).episodes.find(value => value.number === 2);
  assert.equal(missing.published, true);
  assert.equal(missing.obsolete, true);
  assert.deepEqual(missing.editor, { title: 'Mon titre corrigé', overview: 'Mon résumé 🎬' });
  assert.deepEqual(missing.meta, episode(2));
  assert.equal((await store.publicSeason(id, 1)).episodes[0].title, 'Mon titre corrigé');
  saved = await store.patchEpisode(id, saved.entry.version, 'test-admin', 1, 2, { published: false });
  assert.deepEqual((await store.publicSeason(id, 1)).episodes, []);
  await assert.rejects(
    store.patchEpisode(id, saved.entry.version, 'test-admin', 1, 2, { published: true }),
    error => error.code === 'CATALOGUE_EPISODE_OBSOLETE'
  );
});

test('régression épisodes : un brouillon corrigé disparu garde son éditeur et reste non publiable', async () => {
  const { store, id, state } = await fixture();
  let saved = await store.patchEpisode(id, state.entry.version, 'test-admin', 1, 2, { editor: { title: 'Correction privée' } });
  saved = await store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [episode(1)] });
  const missing = (await store.season(id, 1)).episodes.find(value => value.number === 2);
  assert.equal(missing.obsolete, true);
  assert.equal(missing.editor.title, 'Correction privée');
  assert.equal(missing.published, false);
  await assert.rejects(store.patchEpisode(id, saved.entry.version, 'test-admin', 1, 2, { published: true }), error => error.status === 409);
});

test('régression épisodes : retour du même identifiant autorisé, autre identité et renumérotation refusées', async () => {
  const { store, id, state, db } = await fixture();
  let saved = await store.importSeason(id, state.entry.version, 'test-admin', 1, { episodes: [episode(1)] });
  const before = JSON.stringify([...db.data]);
  await assert.rejects(
    store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [episode(1), episode(2, 999)] }),
    error => error.code === 'CATALOGUE_NUMBERING_CHANGED'
  );
  await assert.rejects(
    store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [episode(1), episode(3, 502)] }),
    error => error.code === 'CATALOGUE_NUMBERING_CHANGED'
  );
  assert.equal(JSON.stringify([...db.data]), before);
  saved = await store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [episode(1), episode(2)] });
  const restored = (await store.season(id, 1)).episodes.find(value => value.number === 2);
  assert.equal(restored.obsolete, false);
  assert.equal(restored.obsoleteAt, undefined);
  saved = await store.patchEpisode(id, saved.entry.version, 'test-admin', 1, 2, { published: true });
  assert.equal((await store.season(id, 1)).episodes.find(value => value.number === 2).published, true);
});

test('régression épisodes : une identité inconnue ne réactive pas un ancien épisode obsolète', async () => {
  const { store, id, state } = await fixture();
  let saved = await store.importSeason(id, state.entry.version, 'test-admin', 1, { episodes: [] });
  saved = await store.importSeason(id, saved.entry.version, 'test-admin', 1, { episodes: [{ ...episode(2), tmdbId: null }] });
  const restored = (await store.season(id, 1)).episodes.find(value => value.number === 2);
  assert.equal(restored.obsolete, true);
  assert.equal(restored.meta.tmdbId, 502);
  await assert.rejects(store.patchEpisode(id, saved.entry.version, 'test-admin', 1, 2, { published: true }), error => error.code === 'CATALOGUE_EPISODE_OBSOLETE');
});

test('régression épisodes : import interrompu ne laisse pas publier un guide partiel', async () => {
  const { store, id, state, db } = await fixture();
  const transaction = db.runTransaction.bind(db);
  db.runTransaction = work => transaction(tx => work({
    ...tx,
    set(reference, data) {
      if (reference.path.endsWith('/episodes/1') && data.meta?.title === 'Update interrupted') {
        throw new Error('Simulated write failure');
      }
      tx.set(reference, data);
    }
  }));
  await assert.rejects(
    store.importSeason(id, state.entry.version, 'test-admin', 1, { episodes: [{ ...episode(1), title: 'Update interrupted' }] }),
    /Simulated write failure/
  );
  const current = await store.get(id);
  assert.equal(current.seasons[0].importError, true);
  const guide = await store.season(id, 1);
  assert.equal(guide.episodes.find(value => value.number === 2).obsolete, true);
  assert.equal(guide.episodes.find(value => value.number === 1).meta.title, 'Épisode 1');
  await assert.rejects(
    store.patchEpisode(id, current.entry.version, 'test-admin', 1, 1, { published: true }),
    error => error.code === 'CATALOGUE_IMPORT_INCOMPLETE'
  );
});
