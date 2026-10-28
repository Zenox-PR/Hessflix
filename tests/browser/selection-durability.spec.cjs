const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { createMovixServer } = require('../../server.cjs');
const { createCatalogueStore } = require('../../server/catalogue-store.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');
const { media } = require('../../server/tmdb-model.cjs');
const { tv } = require('../fixtures/tmdb.cjs');
test('épisode : rechargement avant verrou du journal conserve et récupère le dernier choix', async ({ page, context }) => {
  const db = createTestFirestore(), store = createCatalogueStore({ getFirestore: async () => db });
  const entry = await store.create(media(tv, 'tv'), 'Série', 'test');
  let state = await store.importSeason(entry.id, entry.version, 'test', 1, { episodes: [1, 2].map(number => ({ number, season: 1, tmdbId: number, title: 'Épisode ' + number, airdate: '2020-01-01' })) });
  for (const number of [1, 2]) state = await store.patchEpisode(entry.id, state.entry.version, 'test', 1, number, { published: true });
  state = await store.patchSeason(entry.id, state.entry.version, 'test', 1, { published: true }); await store.patch(entry.id, state.entry.version, 'test', { status: 'published' });
  const server = createMovixServer({ catalogueStore: store }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  await context.route('https://www.gstatic.com/firebasejs/**', route => route.abort()); await context.route('https://image.tmdb.org/**', route => route.abort());
  try {
    await page.goto(base + '/titre.html?id=' + entry.id); await expect(page.locator('#episode-selected')).toContainText('épisode 1');
    await page.locator('#episode-select').selectOption('2'); await page.waitForFunction(() => window.HessflixPersonal.selection('tmdb-tv-66732')?.episode === 2);
    await page.locator('#episode-select').selectOption('1'); await page.waitForFunction(() => window.HessflixPersonal.selection('tmdb-tv-66732')?.episode === 1);
    await page.evaluate(() => { const original = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (name, ...args) => name.startsWith('hessflix-personal-local:') ? new Promise(resolve => setTimeout(() => resolve(original(name, ...args)), 3000)) : original(name, ...args); });
    await page.locator('#episode-select').selectOption('2');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hessflix-tmdb-episode-v1:guest:primary:66732')).pending)).toBe(true);
    await page.reload(); await expect(page.locator('#episode-selected')).toContainText('épisode 2');
    await page.waitForFunction(() => window.HessflixPersonal.selection('tmdb-tv-66732')?.episode === 2);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hessflix-tmdb-episode-v1:guest:primary:66732')).pending)).toBe(false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
