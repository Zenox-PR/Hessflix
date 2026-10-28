const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createMovixServer } = require('../../server.cjs');
const { createCatalogueStore } = require('../../server/catalogue-store.cjs');
const { createTMDBClient } = require('../../server/tmdb-client.cjs');
const { ADMIN_UID } = require('../../server/policy.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');
const { movie, tv } = require('../fixtures/tmdb.cjs');
const { media } = require('../../server/tmdb-model.cjs');

let server, base, db, catalogue, one, two, series, revoked;
const auth = {
  async verifySessionCookie(value, check) {
    if (value !== 'hero-test-session' || !check || revoked) throw new Error('Invalid test session');
    return { uid: ADMIN_UID, admin: true };
  },
  async getUser() { return { disabled: false, customClaims: { admin: true } }; }
};

test.beforeEach(async ({ context, page }) => {
  db = createTestFirestore();
  revoked = false;
  catalogue = createCatalogueStore({ getFirestore: async () => db });
  async function add(raw, type, category, status = 'published') {
    let entry = await catalogue.create(media(raw, type), category, 'test-only');
    return (await catalogue.patch(entry.id, entry.version, 'test-only', { status })).entry;
  }
  one = await add({ ...movie, id: 101, title: 'Voyage stellaire' }, 'movie', 'Film');
  two = await add({ ...movie, id: 102, title: 'La dernière nuit' }, 'movie', 'Film');
  series = await add(tv, 'tv', 'Série');
  await add({ ...movie, id: 999, title: 'Brouillon secret' }, 'movie', 'Film', 'draft');
  await add({ ...movie, id: 998, title: 'Titre masqué' }, 'movie', 'Film', 'hidden');
  const tmdbClient = createTMDBClient({ apiKey: () => '0'.repeat(32), fetchImpl: async url => {
    if (url.pathname.endsWith('/images')) return Response.json({ backdrops: [{ file_path: '/gallery-first.jpg' }, { file_path: '/gallery-second.jpg' }] });
    return Response.json({ genres: [] });
  } });
  server = createMovixServer({ getAuth: () => auth, getFirestore: async () => db, tmdbClient });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ origin: base, getAuth: () => auth, getFirestore: async () => db, tmdbClient });
  server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');
  await context.addCookies([{ name: 'movix_admin', value: 'hero-test-session', url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await page.route('https://image.tmdb.org/**', route => route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(__dirname, '../../assets/discovery/movie-tt0816692.jpg')) }));
  page.on('dialog', dialog => { void dialog.accept(); });
  page.testErrors = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
});

test.afterEach(async ({ page }) => {
  await new Promise(resolve => server.close(resolve));
  expect(page.testErrors).toEqual([]);
});

async function openHero(page) {
  await page.goto(base + '/admin');
  await expect(page.locator('#catalogue-service-state')).toContainText('connexion disponible');
  await page.getByRole('button', { name: 'Bannière d’accueil', exact: true }).click();
  await expect(page.locator('#admin-hero-candidates [data-add-hero]')).toHaveCount(3);
  await expect(page.locator('#admin-hero-panel')).toHaveAttribute('aria-busy', 'false');
}

async function add(page, entry) { await page.locator('[data-add-hero="' + entry.id + '"]').click(); }

async function save(page) {
  await page.locator('#admin-hero-save').click();
  await expect(page.locator('#admin-hero-feedback')).toContainText('Brouillon enregistré');
}

test('bannière admin : sélection privée, galerie légère, ordre, aperçu puis publication', async ({ page }) => {
  await openHero(page);
  await expect(page.locator('#admin-hero-candidates')).not.toContainText('Brouillon secret');
  await expect(page.locator('#admin-hero-candidates')).not.toContainText('Titre masqué');
  await add(page, one); await add(page, series);
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toEqual([]);
  await expect(page.locator('#admin-hero-publish')).toBeDisabled();
  await page.locator('[data-slot-id="' + one.id + '"]').getByRole('button', { name: /Image de fond/ }).click();
  await expect(page.locator('#admin-hero-gallery')).toBeVisible();
  await expect(page.locator('#admin-hero-gallery-options img').nth(1)).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w500/gallery-first.jpg');
  await page.locator('#admin-hero-gallery-options button').nth(1).click();
  await page.locator('[data-slot-id="' + series.id + '"]').getByRole('button', { name: /Monter/ }).click();
  await expect(page.locator('#admin-hero-selection > li').first()).toHaveAttribute('data-slot-id', series.id);
  await page.locator('#admin-hero-preview').click();
  await expect(page.locator('#admin-hero-preview-view .hero-heading')).toHaveText('Stranger Things');
  await expect(page.locator('#admin-hero-preview-view .eyebrow')).toContainText('APERÇU PRIVÉ');
  await page.locator('#admin-hero-preview-view').getByRole('button', { name: 'Titre suivant', exact: true }).click();
  await expect(page.locator('#admin-hero-preview-view .hero-heading')).toHaveText('Voyage stellaire');
  await save(page);
  const draft = db.data.get('catalogueSettings/homepageHero');
  expect(draft.pending).toBe(true);
  expect(draft.slots[1].image).toBe('https://image.tmdb.org/t/p/w1280/gallery-first.jpg');
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toEqual([]);
  await page.locator('#admin-hero-publish').click();
  await expect(page.locator('#admin-hero-feedback')).toContainText('Bannière publiée');
  const published = (await (await page.request.get(base + '/api/catalogue/featured')).json()).items;
  expect(published.map(item => item.catalogueId)).toEqual([series.id, one.id]);
  expect(db.data.get('catalogueEntries/' + series.id).editor.rank).toBe(1);
  expect(db.data.get('catalogueEntries/' + one.id).editor.featured).toBe(true);
});

test('bannière admin : retrait et publication vide ne suppriment pas les contenus', async ({ page }) => {
  await openHero(page); await add(page, one); await save(page);
  await page.locator('#admin-hero-publish').click(); await expect(page.locator('#admin-hero-feedback')).toContainText('Bannière publiée');
  await page.locator('[data-slot-id="' + one.id + '"]').getByRole('button', { name: /Retirer/ }).click();
  await save(page);
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toHaveLength(1);
  await page.locator('#admin-hero-publish').click(); await expect(page.locator('#admin-hero-feedback')).toContainText('Bannière publiée');
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toEqual([]);
  expect(db.data.has('catalogueEntries/' + one.id)).toBe(true);
});

test('bannière admin : conflit conserve les choix locaux et recharge sans les perdre', async ({ page }) => {
  await openHero(page); await add(page, one);
  db.data.set('catalogueSettings/homepageHero', { version: 1, slots: [{ id: two.id, image: '' }], pending: true, publishedAt: '' });
  await page.locator('#admin-hero-save').click();
  await expect(page.locator('#admin-hero-feedback')).toContainText('Vos choix locaux sont conservés');
  await expect(page.locator('#admin-hero-selection > li')).toHaveCount(1);
  await expect(page.locator('#admin-hero-selection')).toContainText('Voyage stellaire');
  await page.locator('#admin-hero-reload').click();
  await expect(page.locator('#admin-hero-draft-state')).toContainText('Version serveur 1');
  await expect(page.locator('#admin-hero-selection')).toContainText('Voyage stellaire');
  expect(db.data.get('catalogueSettings/homepageHero').slots[0].id).toBe(two.id);
  await save(page);
  expect(db.data.get('catalogueSettings/homepageHero').version).toBe(2);
  expect(db.data.get('catalogueSettings/homepageHero').slots[0].id).toBe(one.id);
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toEqual([]);
});

test('bannière admin : panne reprenable, parent masqué et session révoquée refusés', async ({ page }) => {
  await openHero(page); await add(page, one);
  await page.route('**/api/admin/catalogue/hero', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"CATALOGUE_FIRESTORE_UNAVAILABLE"}' }) : route.continue());
  await page.locator('#admin-hero-save').click();
  await expect(page.locator('#admin-hero-feedback')).toContainText('Aucun enregistrement');
  await expect(page.locator('#admin-hero-selection')).toContainText('Voyage stellaire');
  await expect(page.locator('#admin-hero-save')).toBeEnabled();
  await page.unroute('**/api/admin/catalogue/hero'); await save(page);
  await catalogue.patch(one.id, one.version, 'test-only', { status: 'hidden' });
  await page.locator('#admin-hero-publish').click();
  await expect(page.locator('#admin-hero-feedback')).toContainText('Retirez-le');
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items).toEqual([]);
  revoked = true;
  expect((await page.request.get(base + '/api/admin/catalogue/hero')).status()).toBe(401);
});

test('bannière admin : mobile, clavier et fenêtre de galerie accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHero(page); await add(page, one); await add(page, two);
  const move = page.locator('[data-slot-id="' + two.id + '"]').getByRole('button', { name: /Monter/ });
  await move.focus(); await page.keyboard.press('Space');
  await expect(page.locator('#admin-hero-selection > li').first()).toHaveAttribute('data-slot-id', two.id);
  await page.locator('[data-slot-id="' + two.id + '"]').getByRole('button', { name: /Image de fond/ }).click();
  await expect(page.locator('#admin-hero-gallery')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#admin-hero-gallery')).toBeHidden();
  await page.locator('#admin-hero-preview').click();
  await expect(page.locator('#admin-hero-preview-view .hero-heading')).toHaveText('La dernière nuit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = path.join(__dirname, '../../output/hero-admin'); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
});

test('épisodes admin : obsolètes signalés, nouveaux blocages et masquage conservés', async ({ page }) => {
  let state = await catalogue.importSeason(series.id, series.version, 'test-only', 1, { episodes: [{ number: 1, tmdbId: 501, title: 'Épisode conservé' }, { number: 2, tmdbId: 502, title: 'Ancien brouillon' }] });
  state = await catalogue.patchEpisode(series.id, state.entry.version, 'test-only', 1, 1, { published: true });
  await catalogue.importSeason(series.id, state.entry.version, 'test-only', 1, { episodes: [] });
  await page.goto(base + '/admin'); await page.locator('[data-admin-tab="library"]').click();
  const card = page.locator('#admin-library-results article').filter({ hasText: 'Stranger Things' });
  await card.getByRole('button', { name: 'Gérer ce contenu', exact: true }).click();
  await page.getByRole('button', { name: 'Gérer les épisodes', exact: true }).click();
  await expect(page.locator('.admin-episode-obsolete')).toHaveCount(2);
  await expect(page.locator('.admin-episode-row').nth(1).locator('input[type=checkbox]')).toBeDisabled();
  const published = page.locator('.admin-episode-row').first();
  await expect(published.locator('input[type=checkbox]')).toBeEnabled();
  await published.locator('input[type=checkbox]').uncheck();
  await published.getByRole('button', { name: 'Enregistrer cet épisode' }).click();
  await expect(page.locator('.admin-episode-row').first().locator('input[type=checkbox]')).toBeDisabled();
});

test('bannière admin : les anciens contrôles featured et ordre restent cohérents', async ({ page }) => {
  await openHero(page);
  await page.locator('[data-admin-tab="library"]').click();
  const card = page.locator('#admin-library-results article').filter({ hasText: 'Voyage stellaire' });
  await card.getByRole('button', { name: 'Gérer ce contenu', exact: true }).click();
  await page.locator('#admin-editor-featured').check();
  await page.locator('#admin-editor-rank').fill('7');
  await page.locator('#admin-editor-form button[type=submit]').click();
  await expect(page.locator('#admin-content-editor .catalogue-feedback')).toContainText('Modification enregistrée');
  await page.locator('#admin-editor-close').click();
  await page.locator('[data-admin-tab="hero"]').click();
  await expect(page.locator('#admin-hero-selection')).toContainText('Voyage stellaire');
  await expect(page.locator('#admin-hero-public-state')).toContainText('1 titre');
  expect((await (await page.request.get(base + '/api/catalogue/featured')).json()).items[0].catalogueId).toBe(one.id);
});
