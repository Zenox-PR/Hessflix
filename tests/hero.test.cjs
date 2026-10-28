const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHeroStore, MAX_SLIDES, MAX_AFFECTED_ENTRIES, validImage } = require('../server/hero-store.cjs');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const { media } = require('../server/tmdb-model.cjs');
const { movie, tv } = require('./fixtures/tmdb.cjs');
const model = require('../server/catalogue-model.cjs');

const ADMIN = 'test-admin';
const NOW = '2026-10-26T01:00:00.000Z';
const url = name => 'https://image.tmdb.org/t/p/w1280/' + name + '.jpg';

async function fixture() {
  const db = createTestFirestore();
  const catalogue = createCatalogueStore({ getFirestore: async () => db, now: () => NOW });
  const gallery = new Map();
  const hero = createHeroStore({ getFirestore: async () => db, catalogue, images: async entry => gallery.get(entry.id) || [], now: () => NOW });
  async function add(id, status = 'published', type = 'movie', editor = {}) {
    const raw = type === 'movie' ? { ...movie, id, title: 'Titre ' + id, backdrop_path: '/background-' + id + '.jpg' } : { ...tv, id };
    let entry = await catalogue.create(media(raw, type), type === 'movie' ? 'Film' : 'Série', ADMIN);
    ({ entry } = await catalogue.patch(entry.id, entry.version, ADMIN, { status, editor }));
    gallery.set(entry.id, [url('gallery-' + id)]);
    return entry;
  }
  const one = await add(101), two = await add(102);
  return { db, catalogue, hero, add, one, two, gallery };
}

test('bannière : brouillon et prévisualisation ne modifient pas les publications', async () => {
  const { db, hero, one, two, catalogue } = await fixture();
  const before = JSON.stringify([...db.data].filter(([key]) => key.startsWith('publicCatalogue/')));
  const draft = await hero.save(0, [{ id: two.id, image: url('gallery-102') }, { id: one.id, image: '' }], ADMIN);
  assert.equal(draft.pending, true);
  assert.equal(draft.version, 1);
  assert.deepEqual(draft.entries.map(slot => slot.id), [two.id, one.id]);
  assert.equal(draft.entries[0].item.heroBackdrop, url('gallery-102'));
  assert.equal(draft.entries[0].available, true);
  assert.deepEqual(await hero.publicItems(), []);
  assert.equal(JSON.stringify([...db.data].filter(([key]) => key.startsWith('publicCatalogue/'))), before);
  assert.equal((await catalogue.get(one.id)).entry.editor.featured, false);
});

test('bannière : publication réutilise featured/rank et retire les anciennes sélections', async () => {
  const { hero, one, two, catalogue } = await fixture();
  let draft = await hero.save(0, [{ id: two.id, image: url('gallery-102') }, { id: one.id, image: '' }], ADMIN);
  let result = await hero.publish(draft.version, ADMIN);
  assert.equal(result.pending, false);
  assert.deepEqual(result.published.map(item => item.catalogueId), [two.id, one.id]);
  assert.equal((await catalogue.get(two.id)).entry.editor.rank, 1);
  assert.equal((await catalogue.get(one.id)).entry.editor.rank, 2);
  assert.equal((await catalogue.publicGet(two.id)).heroBackdrop, url('gallery-102'));
  draft = await hero.save(result.version, [{ id: one.id, image: '' }, { id: two.id, image: '' }], ADMIN);
  result = await hero.publish(draft.version, ADMIN);
  assert.deepEqual(result.published.map(item => item.catalogueId), [one.id, two.id]);
  draft = await hero.save(result.version, [{ id: one.id, image: '' }], ADMIN);
  result = await hero.publish(draft.version, ADMIN);
  assert.deepEqual(result.published.map(item => item.catalogueId), [one.id]);
  assert.equal((await catalogue.get(two.id)).entry.editor.featured, false);
});

test('bannière : supprimer toute la sélection est une publication explicite et réversible', async () => {
  const { hero, one, catalogue } = await fixture();
  let draft = await hero.save(0, [{ id: one.id, image: '' }], ADMIN);
  let saved = await hero.publish(draft.version, ADMIN);
  draft = await hero.save(saved.version, [], ADMIN);
  assert.equal((await hero.publicItems()).length, 1);
  saved = await hero.publish(draft.version, ADMIN);
  assert.deepEqual(saved.published, []);
  assert.equal((await catalogue.get(one.id)).entry.editor.featured, false);
  assert.equal((await catalogue.publicGet(one.id)).title, one.meta.title);
});

test('bannière : doublons, champs inconnus, versions et images non autorisées refusés', async () => {
  const { hero, one, two } = await fixture();
  for (const [slots, code] of [
    [[{ id: one.id, image: '' }, { id: one.id, image: '' }], 'HERO_DUPLICATE'],
    [[{ id: one.id, image: '', admin: true }], 'CATALOGUE_INVALID_FIELDS'],
    [[{ id: one.id, image: 'javascript:alert(1)' }], 'HERO_INVALID_IMAGE'],
    [[{ id: one.id, image: 'https://evil.invalid/background.jpg' }], 'HERO_INVALID_IMAGE'],
    [[{ id: one.id, image: url('gallery-102') }], 'HERO_INVALID_IMAGE'],
    [[{ id: one.id, image: two.meta.backdrop }], 'HERO_INVALID_IMAGE'],
    [[{ id: one.id, image: null }], 'HERO_INVALID_IMAGE'],
    [[{ id: '../../private', image: '' }], 'CATALOGUE_INVALID_ID']
  ]) await assert.rejects(hero.save(0, slots, ADMIN), error => error.code === code);
  for (const version of [-1, 0.1, '0', NaN]) await assert.rejects(hero.save(version, [], ADMIN), error => error.code === 'HERO_INVALID_DRAFT');
  await assert.rejects(hero.save(0, Array.from({ length: MAX_SLIDES + 1 }, () => ({ id: one.id, image: '' })), ADMIN), error => error.code === 'HERO_INVALID_DRAFT');
  assert.equal((await hero.read()).version, 0);
});

test('bannière : contenus inconnus, brouillons et masqués jamais ajoutés', async () => {
  const { hero, add } = await fixture();
  const draft = await add(103, 'draft'), hidden = await add(104, 'hidden');
  for (const entry of [draft, hidden]) await assert.rejects(hero.save(0, [{ id: entry.id, image: '' }], ADMIN), error => error.code === 'HERO_PUBLISHED_ONLY');
  await assert.rejects(hero.save(0, [{ id: 'tmdb-movie-999', image: '' }], ADMIN), error => error.status === 404);
  assert.deepEqual(await hero.publicItems(), []);
});

test('bannière : masquage après sauvegarde bloque la publication atomiquement', async () => {
  const { hero, catalogue, one, two, db } = await fixture();
  const draft = await hero.save(0, [{ id: one.id, image: '' }, { id: two.id, image: '' }], ADMIN);
  await catalogue.patch(two.id, two.version, ADMIN, { status: 'hidden' });
  const before = JSON.stringify([...db.data]);
  await assert.rejects(hero.publish(draft.version, ADMIN), error => error.code === 'HERO_PUBLISHED_ONLY');
  assert.equal(JSON.stringify([...db.data]), before);
  const result = await hero.read();
  assert.equal(result.entries.find(slot => slot.id === two.id).available, false);
  assert.equal(result.pending, true);
});

test('bannière : le parent est revérifié après le chargement lent de la galerie', async () => {
  const { catalogue, one, db } = await fixture();
  let changed = false;
  const hero = createHeroStore({ getFirestore: async () => db, catalogue, images: async () => {
    if (!changed) { changed = true; await catalogue.patch(one.id, one.version, ADMIN, { status: 'hidden' }); }
    return [url('gallery-101')];
  }});
  await assert.rejects(hero.save(0, [{ id: one.id, image: url('gallery-101') }], ADMIN), error => error.code === 'HERO_PUBLISHED_ONLY');
  assert.equal(db.data.has('catalogueSettings/homepageHero'), false);
});

test('bannière : conflits de version et import actif ne produisent aucune écriture partielle', async () => {
  const { hero, one, db } = await fixture();
  const draft = await hero.save(0, [{ id: one.id, image: '' }], ADMIN);
  await assert.rejects(hero.save(0, [], ADMIN), error => error.code === 'HERO_CONFLICT');
  await assert.rejects(hero.publish(0, ADMIN), error => error.code === 'HERO_CONFLICT');
  db.data.get('catalogueEntries/' + one.id).lock = { nonce: 'other-import', startedAt: Date.now() };
  const before = JSON.stringify([...db.data]);
  await assert.rejects(hero.publish(draft.version, ADMIN), error => error.code === 'CATALOGUE_IMPORT_BUSY');
  assert.equal(JSON.stringify([...db.data]), before);
});

test('bannière : galerie en panne conserve une image déjà connue et un remplacement neutre', async () => {
  const { catalogue, one, db } = await fixture();
  const hero = createHeroStore({ getFirestore: async () => db, catalogue, images: async () => { throw new Error('Network'); } });
  const gallery = await hero.gallery(one.id);
  assert.ok(gallery.warning);
  assert.deepEqual(gallery.images, [one.meta.backdrop]);
  let draft = await hero.save(0, [{ id: one.id, image: one.meta.backdrop }], ADMIN);
  await hero.publish(draft.version, ADMIN);
  const latest = await catalogue.get(one.id);
  await catalogue.refresh(one.id, latest.entry.version, ADMIN, { backdrop: url('changed-metadata') });
  assert.equal((await catalogue.publicGet(one.id)).heroBackdrop, one.meta.backdrop);
  assert.ok((await hero.gallery(one.id)).images.includes(one.meta.backdrop));
  draft = await hero.save((await hero.read()).version, [{ id: one.id, image: '' }], ADMIN);
  assert.equal(draft.entries.length, 1);
});

test('bannière : les corrections manuelles et saisons publiées restent intactes', async () => {
  const { hero, catalogue, add } = await fixture();
  let entry = await add(66732, 'published', 'tv', { title: 'Titre corrigé', overview: 'Résumé corrigé', collection: 'Ma collection', platforms: ['netflix'] });
  let state = await catalogue.importSeason(entry.id, entry.version, ADMIN, 1, { episodes: [{ number: 1, season: 1, tmdbId: 900, title: 'Épisode conservé' }] });
  state = await catalogue.patchEpisode(entry.id, state.entry.version, ADMIN, 1, 1, { published: true, editor: { title: 'Épisode corrigé' } });
  state = await catalogue.patchSeason(entry.id, state.entry.version, ADMIN, 1, { published: true });
  const before = await catalogue.publicSeason(entry.id, 1);
  const draft = await hero.save(0, [{ id: entry.id, image: '' }], ADMIN);
  await hero.publish(draft.version, ADMIN);
  entry = (await catalogue.get(entry.id)).entry;
  assert.equal(entry.editor.title, 'Titre corrigé');
  assert.equal(entry.editor.overview, 'Résumé corrigé');
  assert.equal(entry.editor.collection, 'Ma collection');
  assert.deepEqual(entry.editor.platforms, ['netflix']);
  assert.deepEqual(await catalogue.publicSeason(entry.id, 1), before);
});

test('bannière : les contrôles featured/rank existants restent la source de vérité hors brouillon', async () => {
  const { hero, one, two, catalogue } = await fixture();
  const draft = await hero.save(0, [{ id: one.id, image: '' }], ADMIN);
  await hero.publish(draft.version, ADMIN);
  const first = (await catalogue.get(one.id)).entry;
  await catalogue.patch(one.id, first.version, ADMIN, { editor: { featured: false } });
  await catalogue.patch(two.id, two.version, ADMIN, { editor: { featured: true, rank: 1 } });
  const read = await hero.read();
  assert.equal(read.pending, false);
  assert.deepEqual(read.entries.map(slot => slot.id), [two.id]);
  assert.deepEqual(read.published.map(item => item.catalogueId), [two.id]);
});

test('bannière : retirer plus de 40 anciens featured, y compris masqués, sans dépasser 500 écritures', async () => {
  const { db, hero, one, catalogue } = await fixture();
  for (let number = 200; number < 260; number++) {
    const item = { ...one, id: 'tmdb-movie-' + number, tmdbId: number, status: number === 259 ? 'hidden' : 'published', editor: { ...one.editor, featured: true, rank: number } };
    db.data.set('catalogueEntries/' + item.id, item);
    if (item.status === 'published') db.data.set('publicCatalogue/' + item.id, model.projection(item));
  }
  const draft = await hero.save(0, [], ADMIN);
  let writes = 0;
  const transaction = db.runTransaction.bind(db);
  db.runTransaction = work => transaction(tx => work({ ...tx, set(ref, data) { writes++; tx.set(ref, data); }, delete(ref) { writes++; tx.delete(ref); } }));
  await hero.publish(draft.version, ADMIN);
  assert.ok(writes <= 500);
  assert.deepEqual(await hero.publicItems(), []);
  for (let number = 200; number < 260; number++) assert.equal((await catalogue.get('tmdb-movie-' + number)).entry.editor.featured, false);
  const hidden = (await catalogue.get('tmdb-movie-259')).entry;
  await catalogue.patch(hidden.id, hidden.version, ADMIN, { status: 'published' });
  assert.deepEqual(await hero.publicItems(), []);
});

test('bannière : configuration trop volumineuse refusée avant toute écriture', async () => {
  const { db, hero, one } = await fixture();
  // A readable private-only overflow is enough to exceed the transaction budget.
  const draft = await hero.save(0, [], ADMIN);
  for (let number = 1000; number < 1000 + MAX_AFFECTED_ENTRIES + 1; number++) {
    const id = 'tmdb-movie-' + number;
    db.data.set('catalogueEntries/' + id, { ...one, id, editor: { ...one.editor, featured: true }, status: 'hidden' });
  }
  const before = JSON.stringify([...db.data]);
  await assert.rejects(hero.publish(draft.version, ADMIN), error => error.code === 'HERO_CONFIGURATION_TOO_LARGE');
  assert.equal(JSON.stringify([...db.data]), before);
});

test('bannière : projection orpheline retirée mais aucun document privé supprimé', async () => {
  const { db, hero, one } = await fixture();
  const orphan = { ...model.projection(one), id: 'tmdb-movie-999', catalogueId: 'tmdb-movie-999', featured: true };
  db.data.set('publicCatalogue/tmdb-movie-999', orphan);
  const draft = await hero.save(0, [], ADMIN);
  await hero.publish(draft.version, ADMIN);
  assert.equal(db.data.has('publicCatalogue/tmdb-movie-999'), false);
  assert.equal(db.data.has('catalogueEntries/' + one.id), true);
});

test('bannière : réponse publique bornée aux champs nécessaires', async () => {
  const { db, hero, one } = await fixture();
  const large = { ...model.projection(one), featured: true, alternativeTitles: ['Données inutiles'], tmdbSeasons: [{ number: 1 }], searchKeys: ['Recherche privée'], editor: { title: 'Privé' } };
  db.data.set('publicCatalogue/' + one.id, large);
  const [item] = await hero.publicItems();
  assert.equal(item.title, one.meta.title);
  for (const key of ['searchKeys', 'providerFlags', 'status', 'editor', 'tmdbSeasons', 'alternativeTitles']) assert.equal(key in item, false);
  assert.equal(validImage('https://image.tmdb.org/t/p/w1280/' + 'a'.repeat(2100) + '.jpg'), false);
});

test('bannière : deux modifications concurrentes ne remplacent pas un brouillon plus récent', async () => {
  const { hero, one, two, catalogue } = await fixture();
  const drafts = await Promise.allSettled([
    hero.save(0, [{ id: one.id, image: '' }], ADMIN),
    hero.save(0, [{ id: two.id, image: '' }], ADMIN)
  ]);
  assert.equal(drafts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(drafts.find(result => result.status === 'rejected').reason.code, 'HERO_CONFLICT');
  const draft = await hero.read();
  const id = draft.entries[0].id;
  const before = (await catalogue.get(id)).entry.version;
  const published = await Promise.allSettled([hero.publish(draft.version, ADMIN), hero.publish(draft.version, ADMIN)]);
  assert.equal(published.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(published.find(result => result.status === 'rejected').reason.code, 'HERO_CONFLICT');
  assert.equal((await catalogue.get(id)).entry.version, before + 1);
});

test('bannière : budget atomique vérifié sur l’union anciens et nouveaux titres', async () => {
  const { db, hero, one, two } = await fixture();
  const draft = await hero.save(0, [{ id: one.id, image: '' }, { id: two.id, image: '' }], ADMIN);
  for (let index = 0; index < MAX_AFFECTED_ENTRIES - 1; index++) {
    const id = 'tmdb-movie-' + (1000 + index);
    db.data.set('catalogueEntries/' + id, { ...one, id, editor: { ...one.editor, featured: true }, status: 'hidden' });
  }
  const before = JSON.stringify([...db.data]);
  await assert.rejects(hero.publish(draft.version, ADMIN), error => error.code === 'HERO_CONFIGURATION_TOO_LARGE');
  assert.equal(JSON.stringify([...db.data]), before);
  db.data.delete('catalogueEntries/tmdb-movie-1000');
  let writes = 0;
  const transaction = db.runTransaction.bind(db);
  db.runTransaction = work => transaction(tx => work({ ...tx, set(ref, data) { writes++; tx.set(ref, data); }, delete(ref) { writes++; tx.delete(ref); } }));
  await hero.publish(draft.version, ADMIN);
  assert.equal(writes, MAX_AFFECTED_ENTRIES * 2 + 1);
  assert.ok(writes < 500);
});
