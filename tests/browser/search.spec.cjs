const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { createMovixServer } = require('../../server.cjs');
const { createCatalogueStore } = require('../../server/catalogue-store.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');
const { media } = require('../../server/tmdb-model.cjs');
const { movie, tv } = require('../fixtures/tmdb.cjs');
let server, base;
test.beforeEach(async ({ context }) => {
  const db = createTestFirestore(), store = createCatalogueStore({ getFirestore: async () => db });
  for (const [id, title, type, category, status] of [
    [100001, 'Échos : l’aventure', 'movie', 'Film', 'published'],
    [100002, 'La Mission Impossible', 'tv', 'Série', 'published'],
    [100003, 'Naruto', 'tv', 'Anime', 'published'],
    [100004, 'Secret caché', 'movie', 'Film', 'hidden']
  ]) {
    const item = media(type === 'movie' ? { ...movie, id, title } : { ...tv, id, name: title }, type);
    const entry = await store.create(item, category, 'test-only');
    await store.patch(entry.id, entry.version, 'test-only', { status });
  }
  server = createMovixServer({ catalogueStore: store }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = 'http://127.0.0.1:' + server.address().port;
  await context.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await context.route('https://image.tmdb.org/**', route => route.abort());
});
test.afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

test('recherche : fragments, accents et lettre unique restent visibles après réponse serveur', async ({ page }) => {
  await page.goto(base + '/');
  const input = page.locator('#search'), cards = page.locator('#catalogue-cards .discovery-card');
  for (const query of ['chos', 'ECHOS', 'l aventure', 'a']) {
    const response = page.waitForResponse(r => r.url().includes('/api/catalogue?') && new URL(r.url()).searchParams.get('query') === query);
    await input.fill(query); await response;
    const expected = await (await page.request.get(base + '/api/catalogue?' + new URLSearchParams({ query, limit: '50' }))).json();
    await expect(cards).toHaveCount(expected.items.length); expect(expected.items.length).toBeGreaterThan(0);
  }
  await input.fill('Échos'); await input.press('Enter');
  await expect(page.locator('#resultats')).toBeInViewport();
  await expect(page.locator('#catalogue-cards')).toContainText('Échos');
  await input.press('Escape'); await expect(input).toHaveValue(''); await expect(page.locator('#resultats')).toBeHidden();
});

test('recherche : catégories combinées, animes et contenus non publiés exclus', async ({ page }) => {
  await page.goto(base + '/'); await page.locator('#search').fill('nar');
  await page.locator('[data-filter="Anime"]').click();
  await expect(page.locator('#catalogue-cards')).toContainText('Naruto');
  await page.locator('[data-filter="Film"]').click();
  await expect(page.locator('#catalogue-cards .discovery-card')).toHaveCount(0);
  await page.locator('[data-filter="Tous"]').click(); await page.locator('#search').fill('Secret caché');
  await expect(page.locator('#catalogue-empty')).toBeVisible();
});

test('recherche mobile : Entrée ouvre les résultats et les réponses dépassées ne les remplacent pas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/catalogue?**', async route => {
    if (new URL(route.request().url()).searchParams.get('query') === 'old') { await gate; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) }).catch(() => {}); }
    else await route.continue();
  });
  try {
    await page.goto(base + '/'); await page.locator('#search').fill('old'); await page.waitForTimeout(300);
    await page.locator('#search').fill('Mission'); await page.locator('#search').press('Enter');
    await expect(page.locator('#catalogue-cards')).toContainText('La Mission Impossible'); release();
    await expect(page.locator('#catalogue-cards')).toContainText('La Mission Impossible');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});
