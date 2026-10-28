const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createMovixServer } = require('../../server.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');

let server, base, db;
const image = readFileSync(path.join(__dirname, '../../assets/discovery/movie-tt0816692.jpg'));
const pageHTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="hero.css"><script src="catalogue-model.js" defer></script><script src="hero.js" defer></script></head><body><main><section class="hero cinematic-hero" data-hero-banner></section><button id="after-hero">Une autre commande</button></main></body></html>`;

function item(number, extra = {}) {
  return {
    id: 'tmdb-movie-' + number, catalogueId: 'tmdb-movie-' + number,
    title: { 101: 'Alpha', 102: 'Bêta', 103: 'Gamma' }[number] || 'Sélection ' + number,
    kind: 'Film', year: '2024', rating: '8.2', overview: 'Une histoire à découvrir jusqu’au dernier mot.',
    heroBackdrop: 'https://image.tmdb.org/t/p/w1280/hero-' + number + '.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w1280/hero-' + number + '.jpg',
    featured: true, status: 'published', rank: number,
    availability: [{ platform: 'netflix', country: 'FR', type: 'subscription', sourceURL: 'https://www.justwatch.com/fr/film/alpha', watchURL: 'https://www.netflix.com/title/' + number, checkedAt: '2026-10-26T00:00:00Z' }],
    ...extra
  };
}

function seed(items) {
  for (const key of db.data.keys()) if (key.startsWith('publicCatalogue/')) db.data.delete(key);
  for (const value of items) db.data.set('publicCatalogue/' + value.id, value);
}

async function ready(page, title = 'Alpha') {
  await expect(page.locator('.hero-heading')).toHaveText(title);
  await expect(page.locator('[data-hero-banner]')).toHaveAttribute('aria-busy', 'false');
}

test.beforeEach(async ({ page, context }) => {
  db = createTestFirestore(); seed([item(101), item(102), item(103)]);
  // Explicit Firestore injection: no ADC, live Firebase account or cloud writes are used.
  server = createMovixServer({ getFirestore: async () => db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  await context.route('**/hero-fixture.html', route => route.fulfill({ contentType: 'text/html', body: pageHTML }));
  await context.route('https://image.tmdb.org/**', route => route.fulfill({ contentType: 'image/jpeg', body: image }));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('https://fonts.gstatic.com/**', route => route.abort());
  page.errors = []; page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
});

test('hero: published selection only, administrator ordering, correct links and one prioritized image', async ({ page }) => {
  seed([item(101, { rank: 2 }), item(102, { rank: 1 }), item(103, { status: 'hidden' }), item(104, { featured: false })]);
  const requests = []; page.on('request', request => { if (request.url().startsWith('https://image.tmdb.org/')) requests.push(request.url()); });
  await page.goto(base + '/hero-fixture.html'); await ready(page, 'Bêta');
  await expect(page.locator('.hero-indicator')).toHaveCount(2);
  await expect(page.locator('.hero-position')).toHaveText('01 / 02');
  await expect(page.locator('#hero-info')).toHaveAttribute('href', '/titre.html?id=tmdb-movie-102');
  await expect(page.locator('#hero-play')).toHaveAttribute('href', 'https://www.netflix.com/title/102');
  await expect(page.locator('.hero-photo img')).toHaveAttribute('fetchpriority', 'high');
  await expect(page.locator('.hero-photo img')).toHaveAttribute('width', '1920');
  await expect(page.locator('.hero-photo img')).toHaveAttribute('height', '1080');
  expect(requests).toHaveLength(1); expect(requests[0]).toContain('hero-102.jpg');
  await expect(page.locator('.hero-description')).toHaveText('Une histoire à découvrir jusqu’au dernier mot.');
  await expect(page.locator('.hero-rating')).toHaveText('★ 8.2');
});

test('hero: slow obsolete image never replaces a newer title after fast navigation', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let betaRequested = false;
  await page.route('https://image.tmdb.org/**/hero-102.jpg', async route => {
    betaRequested = true; await gate;
    try { await route.fulfill({ contentType: 'image/jpeg', body: image }); } catch { /* Browser cancellation is expected. */ }
  });
  try {
    await page.goto(base + '/hero-fixture.html'); await ready(page);
    await page.getByRole('button', { name: 'Titre suivant', exact: true }).click();
    await expect.poll(() => betaRequested).toBe(true);
    await expect(page.locator('.hero-heading')).toHaveText('Alpha');
    await page.getByRole('button', { name: 'Titre suivant', exact: true }).click();
    await ready(page, 'Gamma');
    release();
    await expect(page.locator('#hero-info')).toHaveAttribute('href', '/titre.html?id=tmdb-movie-103');
    await expect.poll(() => page.locator('.hero-photo img').evaluate(image => image.currentSrc)).toMatch(/hero-103\.jpg/);
    await expect(page.locator('.hero-indicator[aria-current="true"]')).toHaveAttribute('aria-label', 'Afficher Gamma');
  } finally { release(); }
});

test('hero: keyboard arrows, Home/End and indicators keep content and destination aligned', async ({ page }) => {
  await page.goto(base + '/hero-fixture.html'); await ready(page);
  await page.getByRole('button', { name: 'Afficher Alpha', exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await ready(page, 'Bêta');
  await page.keyboard.press('End'); await ready(page, 'Gamma');
  await page.keyboard.press('Home'); await ready(page, 'Alpha');
  await page.getByRole('button', { name: 'Afficher Gamma', exact: true }).focus();
  await page.keyboard.press('Enter'); await ready(page, 'Gamma');
  await expect(page.locator('#hero-info')).toHaveAttribute('href', '/titre.html?id=tmdb-movie-103');
  await expect(page.getByRole('button', { name: 'Activer le défilement', exact: true })).toBeVisible();
});

test('hero: pause, automatic rotation and reduced motion are respected', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  await page.goto(base + '/hero-fixture.html'); await ready(page);
  await page.mouse.move(0, 0); await page.clock.fastForward(9000); await ready(page, 'Bêta');
  await page.getByRole('button', { name: 'Mettre le défilement en pause', exact: true }).click();
  await page.locator('#after-hero').focus(); await page.mouse.move(0, 0);
  await page.clock.fastForward(22000); await expect(page.locator('.hero-heading')).toHaveText('Bêta');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.hero-pause')).toBeHidden();
  await page.clock.fastForward(22000); await expect(page.locator('.hero-heading')).toHaveText('Bêta');
  await page.getByRole('button', { name: 'Afficher Gamma', exact: true }).click(); await ready(page, 'Gamma');
});

test('hero: identical polling clears loading without restarting image or current slide', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calls = [], images = [];
  page.on('request', request => {
    if (request.url().includes('/api/catalogue/featured')) calls.push(request.url());
    if (request.url().startsWith('https://image.tmdb.org/')) images.push(request.url());
  });
  await page.goto(base + '/hero-fixture.html'); await ready(page);
  await page.clock.fastForward(60001);
  await expect.poll(() => calls.length).toBe(2);
  await expect(page.locator('.hero-load-status')).toHaveText('');
  await expect(page.locator('[data-hero-banner]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.hero-heading')).toHaveText('Alpha');
  expect(images).toHaveLength(1);
});

test('hero: empty/single selections, unavailable image and missing facts do not invent data', async ({ page }) => {
  seed([]); await page.goto(base + '/hero-fixture.html');
  await expect(page.locator('.hero-controls')).toBeHidden(); await expect(page.locator('#hero-info')).toBeHidden();
  await expect(page.locator('.hero-heading')).toHaveText('Votre prochaine histoire vous attend.');
  seed([item(101, { rating: '', year: '', availability: [], overview: '', heroBackdrop: '', backdrop: '' })]);
  await page.reload(); await ready(page);
  await expect(page.locator('.hero-rating')).toHaveCount(0);
  await expect(page.locator('.hero-facts')).toHaveText('Film');
  await expect(page.locator('.hero-description')).toHaveText('Synopsis non renseigné.');
  await expect(page.locator('#hero-play')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Titre suivant', exact: true })).toBeDisabled();
  await expect(page.locator('.hero-pause')).toBeHidden(); await expect(page.locator('.hero-photo img')).toHaveCount(0);
  seed([item(101)]); await page.route('https://image.tmdb.org/**', route => route.fulfill({ status: 404, body: '' }));
  await page.reload(); await ready(page); await expect(page.locator('.hero-photo img')).toHaveCount(0);
});

test('hero: API failure clears unavailable selection and retry restores a validated response', async ({ page }) => {
  await page.route('**/api/catalogue/featured', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"UNAVAILABLE"}' }));
  await page.goto(base + '/hero-fixture.html');
  await expect(page.locator('.hero-load-status')).toHaveText('La sélection est temporairement indisponible.');
  await expect(page.locator('.hero-retry')).toBeVisible(); await expect(page.locator('#hero-info')).toBeHidden();
  await page.unroute('**/api/catalogue/featured'); await page.locator('.hero-retry').click(); await ready(page);
  await expect(page.locator('.hero-load-status')).toHaveText(''); await expect(page.locator('.hero-retry')).toBeHidden();
});

test('hero: 12 slides and very long headings fit mobile/tablet without layout shifts', async ({ page }) => {
  const longTitle = 'Une histoire extraordinaire au-delà des frontières du temps et des galaxies lointaines '.repeat(3);
  seed(Array.from({ length: 12 }, (_, index) => item(101 + index, { title: index === 0 ? longTitle : 'Sélection ' + index })));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/catalogue/featured', async route => { await gate; await route.continue(); });
  await page.setViewportSize({ width: 320, height: 780 });
  try {
    await page.goto(base + '/hero-fixture.html');
    await expect(page.locator('[data-hero-banner]')).toHaveCSS('height', '620px');
    const before = await page.locator('#after-hero').boundingBox();
    release(); await ready(page, longTitle.trimEnd());
    const after = await page.locator('#after-hero').boundingBox();
    expect(after.y).toBe(before.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.hero-indicator')).toHaveCount(12);
    await expect(page.locator('.hero-heading')).toHaveAttribute('title', longTitle);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await page.locator('[data-hero-banner]').boundingBox();
      const controls = await page.locator('.hero-controls').boundingBox();
      const actions = await page.locator('.hero-actions').boundingBox();
      expect(controls.y + controls.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(actions.y + actions.height).toBeLessThanOrEqual(controls.y);
    }
    const directory = path.join(__dirname, '../../output/hero-check');
    require('node:fs').mkdirSync(directory, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });
  } finally { release(); }
});

test('hero: preview has no navigating links; remount cancels old image/poll work and preserves controls', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  const calls = []; page.on('request', request => { if (request.url().includes('/api/catalogue/featured')) calls.push(request.url()); });
  await page.goto(base + '/hero-fixture.html'); await ready(page);
  await page.evaluate(items => {
    window.heroPreview = window.HessflixHero.mount(document.querySelector('[data-hero-banner]'), { preview: true, items });
  }, [item(101), item(102)]);
  await expect(page.locator('.hero-heading')).toHaveText('Alpha');
  await expect(page.locator('.hero-actions a[href]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Titre suivant', exact: true }).click(); await ready(page, 'Bêta');
  await expect(page.locator('.hero-actions a[href]')).toHaveCount(0);
  const count = calls.length; await page.clock.fastForward(125000); expect(calls).toHaveLength(count);
  await page.evaluate(() => window.heroPreview.destroy());
  await page.getByRole('button', { name: 'Titre précédent', exact: true }).click();
  await expect(page.locator('.hero-heading')).toHaveText('Bêta');
});

test('hero: hidden tabs suspend polling and automatic rotation until visible again', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  const calls = []; page.on('request', request => { if (request.url().includes('/api/catalogue/featured')) calls.push(request.url()); });
  await page.goto(base + '/hero-fixture.html'); await ready(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = calls.length;
  await page.clock.fastForward(180000);
  expect(calls).toHaveLength(count); await expect(page.locator('.hero-heading')).toHaveText('Alpha');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => calls.length).toBe(count + 1);
  await expect(page.locator('.hero-load-status')).toHaveText('');
});
