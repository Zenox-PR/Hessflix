const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createMovixServer } = require('../../server.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');
const model = require('../../personal-model.js');

let server, base, db;
const user = { uid: 'recovery-user', displayName: 'Compte de test', email: 'recovery@example.test', photoURL: '', providerData: [{ providerId: 'password' }] };
const appStub = 'export const getApps=()=>[];export const initializeApp=()=>({});';
const authStub = `
 const current={...${JSON.stringify(user)},async getIdTokenResult(){return {claims:{admin:false}};},async getIdToken(){return 'recovery-browser-test-token';}};
 const auth={currentUser:current};export const getAuth=()=>auth;export class GoogleAuthProvider{setCustomParameters(){}}
 export function onIdTokenChanged(instance,callback){queueMicrotask(()=>callback(current));return ()=>{};}
`;

test.beforeEach(async ({ context }) => {
  db = createTestFirestore();
  const getAuth = () => ({ async verifyIdToken(value, check) {
    if (value !== 'recovery-browser-test-token' || check !== true) throw new Error('Invalid test token');
    return { uid: user.uid, admin: false };
  } });
  server = createMovixServer({ getAuth, getFirestore: async () => db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ origin: base, getAuth, getFirestore: async () => db });
  server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appStub }));
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authStub }));
});
test.afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

function seed() {
  const baseState = model.empty();
  for (let id = 1; id <= 499; id++) model.apply(baseState, { type: 'favorite', id: `tmdb-movie-${id}`, value: true });
  const remote = structuredClone(baseState); model.apply(remote, { type: 'favorite', id: 'tmdb-movie-500', value: true });
  db.data.set(`viewerAccounts/${user.uid}/personal/primary`, remote);
  return { device: randomUUID(), next: 3, base: baseState, migrated: true, sending: 0, pending: [
    { type: 'favorite', id: 'tmdb-movie-501', value: true, seq: 1 },
    { type: 'watchlist', id: 'tmdb-tv-66732', value: true, seq: 2 }
  ] };
}

test('favories limit: visible terminal refusal, durable reload, independent valid change and explicit retry on mobile', async ({ page }) => {
  const record = seed();
  await page.addInitScript(record => {
    const key = 'hessflix-personal-v1:recovery-user:primary';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(record));
  }, record);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/compte.html#profil');
  await page.waitForFunction(() => window.HessflixPersonal?.snapshot().rejectedCount === 1 && window.HessflixPersonal.snapshot().pending === 0);
  await expect(page.locator('.personal-sync-notice')).toContainText('500 favoris');
  await expect(page.locator('[data-retry-rejected]')).toBeVisible();
  expect(await page.evaluate(() => window.HessflixPersonal.watchlist())).toEqual(['tmdb-tv-66732']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.HessflixPersonal?.snapshot().rejectedCount === 1);
  await page.evaluate(async () => { await window.HessflixPersonal.setFavorite('tmdb-movie-1', false); await window.HessflixPersonal.sync(); });
  await page.locator('[data-retry-rejected]').click();
  await page.waitForFunction(() => window.HessflixPersonal.snapshot().pending === 0 && window.HessflixPersonal.snapshot().rejectedCount === 0);
  expect(await page.evaluate(() => window.HessflixPersonal.favorites())).toContain('tmdb-movie-501');
  expect(db.data.get(`viewerAccounts/${user.uid}/personal/primary`).favorites.length).toBe(500);
  expect(errors).toEqual([]);
});

test('network failures: do not mislabel a retryable operation as rejected', async ({ page }) => {
  const empty = model.empty(); db.data.set(`viewerAccounts/${user.uid}/personal/primary`, empty);
  await page.goto(base + '/compte.html#profil');
  await page.waitForFunction(() => window.HessflixPersonal?.snapshot().syncStatus === 'synced');
  await page.route('**/api/personal/**', route => route.abort());
  await page.evaluate(async () => { await window.HessflixPersonal.setFavorite('tmdb-movie-501', true); await window.HessflixPersonal.sync(); });
  await expect(page.locator('.personal-sync-notice')).toContainText('conservées sur cet appareil');
  await expect(page.locator('[data-retry-rejected]')).toHaveCount(0);
  expect(await page.evaluate(() => window.HessflixPersonal.snapshot().rejectedCount)).toBe(0);
  await page.unroute('**/api/personal/**'); await page.locator('.personal-sync-notice button').click();
  await page.waitForFunction(() => window.HessflixPersonal.snapshot().pending === 0);
  expect(db.data.get(`viewerAccounts/${user.uid}/personal/primary`).favorites).toEqual(['tmdb-movie-501']);
});
