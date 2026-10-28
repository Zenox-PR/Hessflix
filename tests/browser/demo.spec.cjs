const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { buildDemo } = require('../../scripts/build-demo.cjs');
let server, base, output;
test.beforeAll(async () => {
  output = buildDemo();
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice('/Hessflix/'.length)) || 'index.html'; } catch { response.writeHead(400).end(); return; }
    const file = path.resolve(output, relative);
    if (!url.pathname.startsWith('/Hessflix/') || !file.startsWith(output + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(response);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/Hessflix/`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  page.demoErrors = []; page.demoRequests = [];
  page.on('pageerror', error => page.demoErrors.push(error.message));
  page.on('request', request => page.demoRequests.push(request.url()));
});
test.afterEach(async ({ page }) => {
  expect(page.demoErrors).toEqual([]);
  expect(page.demoRequests.filter(url => !url.startsWith(base))).toEqual([]);
});
async function enter(page) {
  await page.goto(base + 'connexion.html'); await page.locator('#demo-enter').click();
  await page.waitForURL(base + 'compte.html');
  await page.waitForFunction(() => window.MovixAccount?.getUser()?.profileReady === true);
}
async function switchProfile(page, name) {
  await page.locator('.profile-actions [data-switch-profile]').click();
  await page.getByRole('button', { name: new RegExp(name) }).first().click();
  await expect(page.locator('#account-page-name')).toHaveText(name);
}
test('démo statique : catalogue, recherche, animes et plateformes sous /Hessflix/', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('.demo-banner')).toContainText('DÉMONSTRATION');
  await expect(page.locator('#discovery-sections .media-card').first()).toBeVisible();
  await expect(page.locator('#hero-info')).toBeVisible();
  await expect(page.locator('.hero-photo img')).toBeVisible();
  await page.screenshot({ path: path.join(output, '..', 'demo-desktop.png') });
  await page.locator('#search').fill('Interstellar');
  await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
  await page.locator('#catalogue-cards .card-open').click();
  await expect(page.locator('#title-name')).toHaveText('Interstellar');
  await page.getByRole('button', { name: 'Essayer le bouton de lecture' }).click();
  await expect(page.locator('#video-mount')).toContainText('Lecture indisponible');
  expect(await page.locator('iframe').count()).toBe(0);
  await page.goto(base); await page.locator('[data-filter="Anime"]').click();
  await expect(page.locator('#catalogue-cards')).toContainText('Cyberpunk');
  await page.goto(base + 'netflix.html');
  await expect(page.locator('#universe-catalogue .media-card').first()).toBeAttached();
});
test('démo : favoris persistants et séparés entre profils, sans compte réel', async ({ page }) => {
  await enter(page);
  await page.goto(base);
  await page.waitForFunction(() => window.MovixAccount?.getUser()?.profileReady);
  await page.locator('#search').fill('Interstellar');
  await page.locator('#catalogue-cards [data-favorite-id="movie-tt0816692"]').click();
  await page.goto(base + 'compte.html#favoris');
  await expect(page.locator('#profile-favorites-count')).toHaveText('1');
  await expect(page.locator('#profile-feed')).toContainText('Interstellar');
  await page.reload(); await expect(page.locator('#profile-favorites-count')).toHaveText('1');
  await switchProfile(page, 'Explorateur');
  await expect(page.locator('#profile-favorites-count')).toHaveText('0');
  await switchProfile(page, 'Cinéphile');
  await expect(page.locator('#profile-favorites-count')).toHaveText('1');
  expect(await page.evaluate(() => window.MovixAccount.getUser().admin)).toBe(false);
});
test('démo : sélection des épisodes, historique et navigation immédiate', async ({ page }) => {
  await enter(page); await page.goto(base + 'titre.html?id=series-55138');
  await expect(page.locator('#season-select')).toBeVisible();
  await expect(page.locator('#episode-select option')).not.toHaveCount(0);
  await page.locator('#episode-select').selectOption('2');
  await page.getByRole('button', { name: 'Marquer cet épisode comme vu' }).click();
  await page.goto(base + 'compte.html#visionnes');
  await expect(page.locator('#profile-watched-count')).toHaveText('1');
  await switchProfile(page, 'Explorateur'); await expect(page.locator('#profile-watched-count')).toHaveText('0');
  await switchProfile(page, 'Cinéphile');
  await page.goto(base + 'titre.html?id=series-55138');
  await expect(page.locator('#episode-select')).toHaveValue('2');
});
test('démo : mobile, absence de formulaire réel et de fichiers privés', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + 'connexion.html');
  await expect(page.locator('input[type="password"],input[type="email"],#google-signin')).toHaveCount(0);
  await expect(page.locator('#demo-enter')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#demo-enter').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, '..', 'demo-mobile.png'), fullPage: true });
  for (const file of ['.env', 'server.cjs', 'admin-private/dashboard.html', 'admin', 'firestore.rules', 'package.json']) expect((await request.get(base + file)).status()).toBe(404);
  expect(await page.evaluate(async () => (await window.HessflixDemo.request('/api/admin/session')).status)).toBe(404);
});
test('démo : stockage refusé annoncé et actions conservées en mémoire', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'QuotaExceededError'); }; });
  await page.goto(base);
  await page.evaluate(() => window.HessflixPersonal.setFavorite('movie-tt0816692', true));
  await expect(page.locator('#demo-storage-status')).toBeVisible();
  expect(await page.evaluate(() => window.HessflixPersonal.favorites())).toContain('movie-tt0816692');
});
test('démo : création, nom et avatar du profil restent locaux après rechargement', async ({ page }) => {
  await enter(page);
  await page.locator('.profile-actions [data-switch-profile]').click();
  await page.locator('#viewer-add').click(); await page.locator('#viewer-name').fill('Invité démo');
  await page.locator('#viewer-add-form button[type="submit"]').click();
  await expect(page.locator('#account-page-name')).toHaveText('Invité démo');
  await page.locator('#edit-profile-name').click(); await page.locator('#profile-name-input').fill('Mon cinéma');
  await page.locator('#save-profile-name').click();
  await expect(page.locator('#account-page-name')).toHaveText('Mon cinéma');
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  const option = page.locator('.avatar-option').first(); await option.click();
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  const source = await page.locator('#account-page-avatar').getAttribute('src');
  expect(source).toContain('assets/avatars/');
  await page.reload(); await expect(page.locator('#account-page-name')).toHaveText('Mon cinéma');
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', source);
});
test('démo : réinitialisation limitée aux essais et aucune importation des anciennes données', async ({ page }) => {
  await page.goto(base);
  await page.evaluate(() => { localStorage.setItem('personal-unrelated', 'keep'); localStorage.setItem('movix-favorites-v1:guest:primary', '["movie-tt0816692"]'); });
  await page.reload(); expect(await page.evaluate(() => window.HessflixPersonal.favorites())).toEqual([]);
  await enter(page);
  await page.evaluate(() => window.HessflixPersonal.setFavorite('movie-tt0816692', true));
  page.once('dialog', dialog => dialog.accept()); await page.locator('#demo-reset').click();
  await page.waitForURL(base + 'index.html');
  expect(await page.evaluate(() => localStorage.getItem('personal-unrelated'))).toBe('keep');
  expect(await page.evaluate(() => window.HessflixPersonal.favorites())).toEqual([]);
});
