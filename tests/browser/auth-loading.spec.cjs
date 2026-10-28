const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { createMovixServer } = require('../../server.cjs');
const { createTestFirestore, seedApprovedLegacy } = require('../fixtures/catalogue-db.cjs');

const appSDK = 'export const getApps=()=>[];export const initializeApp=()=>({});';
const authSDK = `
export const getAuth=()=>({currentUser:null});
export class GoogleAuthProvider {setCustomParameters(){}}
export const onIdTokenChanged=(auth,callback)=>{queueMicrotask(()=>callback(null));return ()=>{};};
export const signInWithEmailAndPassword=async()=>{};
export const signInWithPopup=async()=>{};
`;
let server, base;
test.beforeAll(async () => {
  const db = seedApprovedLegacy(createTestFirestore());
  server = createMovixServer({ getFirestore: async () => db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ context }) => {
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appSDK }));
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authSDK }));
});

for (const path of ['/index.html', '/netflix.html', '/compte.html', '/titre.html?id=movie-tt0816692']) {
  test('connexion indépendante du catalogue bloqué : ' + path, async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let requested = false;
    await page.route('**/catalogue-data.js', async route => { requested = true; await gate; await route.continue().catch(() => {}); });
    const navigation = page.goto(base + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    try {
      await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready', undefined, { timeout: 3000 });
      expect(requested).toBe(true);
      expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
      await expect(page.locator('[data-account-slot] .account-disconnected')).toBeVisible();
      await expect(page.locator('.catalogue-loading-notice')).toContainText('connexion reste disponible');
      await page.locator('[data-account-slot] .account-disconnected').click();
      await page.waitForURL(/connexion\.html/);
      await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
      await expect(page.locator('.auth-submit')).toBeEnabled();
      await expect(page.locator('#google-signin')).toBeEnabled();
    } finally { release(); await navigation; }
  });
}

test('fiche publiée : reste vérifiée par l’API même si le catalogue initial échoue', async ({ page }) => {
  await page.route('**/catalogue-data.js', route => route.abort());
  await page.goto(base + '/titre.html?id=movie-tt0816692');
  await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
  await expect(page.locator('#title-name')).toHaveText('Interstellar');
  await expect(page.locator('#title-content')).toBeVisible();
  await expect(page.locator('.catalogue-loading-notice')).toContainText('temporairement indisponible');
});

test('catalogue en erreur : message, authentification disponible et reprise explicite', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/catalogue-data.js', route => route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
  await expect(page.locator('.catalogue-loading-notice')).toContainText('temporairement indisponible');
  await expect(page.locator('#continue-cards .continue-card')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.unroute('**/catalogue-data.js');
  await page.locator('.catalogue-loading-notice button').click();
  await expect(page.locator('.catalogue-loading-notice')).toBeHidden();
  await expect(page.locator('#continue-cards .continue-card')).toHaveCount(4);
  expect(errors).toEqual([]);
});

for (const width of [1280, 390]) {
  test('plateformes : place réservée avant le catalogue, largeur ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/catalogue-data.js', async route => { await gate; await route.continue(); });
    const navigation = page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
    const initial = await page.locator('#platform-cards').evaluate(element => element.getBoundingClientRect().height);
    release(); await navigation;
    await expect(page.locator('.platform-card')).toHaveCount(5);
    const loaded = await page.locator('#platform-cards').evaluate(element => element.getBoundingClientRect().height);
    expect(initial).toBeGreaterThan(100);
    expect(Math.abs(loaded - initial)).toBeLessThanOrEqual(1);
  });
}
