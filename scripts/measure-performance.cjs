// Mesures locales reproductibles : base Firestore et identité Firebase simulées.
// Aucun accès aux comptes ou documents réels ; ce script imprime uniquement du JSON.
const { once } = require('node:events');
const { chromium } = require('@playwright/test');
const { createMovixServer } = require('../server.cjs');
const { createTestFirestore, seedApprovedLegacy } = require('../tests/fixtures/catalogue-db.cjs');

const appSDK = 'export const getApps=()=>[];export const initializeApp=()=>({});';
const authSDK = `
const user=window.measureLoggedIn?{uid:'performance-user',displayName:'Profil test',email:'test@example.invalid',photoURL:'',providerData:[],getIdToken:async()=> 'performance-test-token-123456',getIdTokenResult:async()=>({claims:{admin:false}})}:null;
export const getAuth=()=>({currentUser:user});
export class GoogleAuthProvider { setCustomParameters() {} }
export const onIdTokenChanged=(auth,callback)=>{queueMicrotask(()=>callback(user));return ()=>{};};
`;

async function measureAvatars(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => { window.measureLoggedIn = true; });
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appSDK }));
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authSDK }));
  await page.goto(base + '/compte.html');
  await page.waitForFunction(() => window.MovixAccount?.getUser()?.profileReady);
  await page.locator('#profile-avatar-trigger').click();
  const before = await page.evaluate(() => performance.getEntriesByType('resource').filter(item => item.name.includes('/assets/avatars/')).length);
  const started = Date.now();
  await page.locator('#change-avatar').click();
  await page.waitForFunction(() => document.querySelector('.avatar-option img')?.complete && document.querySelector('.avatar-option img')?.naturalWidth > 0);
  const firstVisibleMs = Date.now() - started;
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const avatars = performance.getEntriesByType('resource').filter(item => item.name.includes('/assets/avatars/'));
    return { requestedImages: avatars.length, bodyBytes: avatars.reduce((sum, item) => sum + item.encodedBodySize, 0), availableInCategory: document.querySelectorAll('.avatar-option').length, visibleImageWidth: document.querySelector('.avatar-option img')?.getBoundingClientRect().width, intrinsicImageWidth: document.querySelector('.avatar-option img')?.naturalWidth };
  });
  await context.close();
  return { ...result, requestsBeforeOpening: before, firstVisibleMs };
}

async function measure(browser, base, delay, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appSDK }));
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authSDK }));
  if (delay) await page.route('**/catalogue-data.js', async route => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.continue();
  });
  await page.addInitScript(() => {
    window.performanceSample = { authReady: null, lcp: 0, cls: 0, longTasks: 0, layoutSources: [] };
    window.addEventListener('movix-auth-status', () => {
      if (window.MovixAuthStatus?.state === 'ready') window.performanceSample.authReady ??= performance.now();
    });
    for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'largest-contentful-paint') window.performanceSample.lcp = entry.startTime;
            if (type === 'layout-shift' && !entry.hadRecentInput) {
              window.performanceSample.cls += entry.value;
              if (window.performanceSample.layoutSources.length < 30) window.performanceSample.layoutSources.push({
                value: entry.value,
                time: entry.startTime,
                nodes: entry.sources.map(source => ({ tag: source.node?.tagName, id: source.node?.id, className: typeof source.node?.className === 'string' ? source.node.className : '', previousY: source.previousRect.y, currentY: source.currentRect.y, previousHeight: source.previousRect.height, currentHeight: source.currentRect.height }))
              });
            }
            if (type === 'longtask') window.performanceSample.longTasks += Math.max(0, entry.duration - 50);
          }
        }).observe({ type, buffered: true });
      } catch {}
    }
  });
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
  await page.waitForTimeout(1500);
  const sample = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').filter(resource => resource.name.startsWith(location.origin));
    const avatars = resources.filter(resource => resource.name.includes('/assets/avatars/'));
    const images = resources.filter(resource => resource.initiatorType === 'img');
    return {
      ...window.performanceSample,
      domContentLoaded: navigation.domContentLoadedEventEnd,
      load: navigation.loadEventEnd,
      requestCount: resources.length + 1,
      transferredBytes: resources.reduce((sum, resource) => sum + resource.transferSize, navigation.transferSize),
      resourceBodyBytes: resources.reduce((sum, resource) => sum + resource.encodedBodySize, navigation.encodedBodySize),
      imageBodyBytes: images.reduce((sum, resource) => sum + resource.encodedBodySize, 0),
      avatarRequests: avatars.length,
      avatarBytes: avatars.reduce((sum, resource) => sum + resource.encodedBodySize, 0),
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      catalogueScriptBytes: resources.find(resource => resource.name.endsWith('/catalogue-data.js'))?.encodedBodySize || 0
    };
  });
  sample.clickToPaint = await page.evaluate(() => new Promise(resolve => {
    const button = document.querySelector('[data-filter="Film"]');
    if (!button) { resolve(null); return; }
    const start = performance.now();
    button.addEventListener('click', () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start))), { once: true });
    button.click();
  }));
  await context.close();
  return sample;
}

(async () => {
  const db = seedApprovedLegacy(createTestFirestore());
  const options = { getFirestore: async () => db, getAuth: () => ({ verifyIdToken: async token => { if (token !== 'performance-test-token-123456') throw new Error('Invalid test token'); return { uid: 'performance-user', admin: false }; } }) };
  let server = createMovixServer(options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ ...options, origin: base });
  server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ channel: process.env.MOVIX_TEST_BROWSER_CHANNEL || 'msedge' });
  try {
    if (process.argv[2] === 'avatars') { console.log(JSON.stringify({ label: 'avatars', sample: await measureAvatars(browser, base) }, null, 2)); return; }
    const runs = [];
    for (let index = 0; index < 3; index++) runs.push(await measure(browser, base, 0, { width: 1280, height: 900 }));
    const delayed = await measure(browser, base, 2500, { width: 1280, height: 900 });
    const mobile = await measure(browser, base, 0, { width: 390, height: 844 });
    const median = {};
    for (const key of Object.keys(runs[0])) if (typeof runs[0][key] === 'number') median[key] = runs.map(run => run[key]).sort((a, b) => a - b)[1];
    const avatars = await measureAvatars(browser, base);
    console.log(JSON.stringify({ label: process.argv[2] || 'sample', conditions: { cache: 'disabled', viewport: '1280x900', reducedMotion: true, samples: 3, delayMs: 2500, firebase: 'stubbed', firestore: 'transactional fixture', catalogue: 'seedApprovedLegacy' }, median, delayed, mobile, avatars, runs }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
