const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { createMovixServer } = require('../../server.cjs');
const { createCatalogueStore } = require('../../server/catalogue-store.cjs');
const { createTestFirestore } = require('../fixtures/catalogue-db.cjs');
const { media } = require('../../server/tmdb-model.cjs');
const { movie, tv } = require('../fixtures/tmdb.cjs');
const { ADMIN_UID } = require('../../server/policy.cjs');
const URL1 = 'https://vidmoly.org/embed-aaaaaaaaaaaa.html', URL2 = 'https://vidmoly.org/embed-bbbbbbbbbbbb.html';
let server, base, db, store, film, series;
async function editVideo(id, target = null, action = 'save', url = URL1) {
  const { entry } = await store.get(id);
  return store.changeVideo(id, entry.version, ADMIN_UID, target, action, { url, rightsConfirmed: true });
}
async function setupVideo(id, target = null, url = URL1) { await editVideo(id, target, 'save', url); await editVideo(id, target, 'publish'); }
test.beforeEach(async ({ context }) => {
  db = createTestFirestore(); store = createCatalogueStore({ getFirestore: async () => db });
  film = await store.create(media(movie, 'movie'), 'Film', ADMIN_UID);
  series = await store.create(media(tv, 'tv'), 'Anime', ADMIN_UID);
  for (const id of [film.id, series.id]) { const { entry } = await store.get(id); await store.patch(id, entry.version, ADMIN_UID, { status: 'published' }); }
  for (const number of [1, 2]) {
    let current = await store.get(series.id);
    current = await store.importSeason(series.id, current.entry.version, ADMIN_UID, number, { episodes: [1, 2].map(episode => ({ number: episode, season: number, tmdbId: number * 100 + episode, title: 'Épisode ' + episode, runtime: 24, airdate: '2020-01-01' })) });
    for (const episode of [1, 2]) current = await store.patchEpisode(series.id, current.entry.version, ADMIN_UID, number, episode, { published: true });
    await store.patchSeason(series.id, current.entry.version, ADMIN_UID, number, { published: true });
  }
  const auth = { verifySessionCookie: async token => { if (token !== 'video-session') throw Error('Invalid'); return { uid: ADMIN_UID, admin: true }; }, getUser: async () => ({ disabled: false, customClaims: { admin: true } }) };
  server = createMovixServer({ getAuth: () => auth, catalogueStore: store }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port; await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ origin: base, getAuth: () => auth, catalogueStore: store }); server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');
  await context.addCookies([{ name: 'movix_admin', value: 'video-session', url: base, httpOnly: true, sameSite: 'Strict' }]);
  await context.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await context.route('https://image.tmdb.org/**', route => route.abort());
  await context.route('https://vidmoly.org/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Lecteur SIMULÉ pour tests, aucune vidéo réelle.</body></html>' }));
});
test.afterEach(async () => { await new Promise(resolve => server.close(resolve)); });
async function admin(page, title = 'Interstellar') {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto(base + '/admin'); await page.locator('[data-admin-tab=library]').click();
  const card = page.locator('#admin-library-results article').filter({ hasText: title });
  await card.getByRole('button', { name: 'Gérer ce contenu' }).click();
  await expect(page.locator('#admin-content-editor')).toBeVisible();
}
async function save(panel, url) {
  await panel.getByLabel('Lien vidéo Vidmoly').fill(url);
  await panel.getByLabel('Je suis autorisé à diffuser cette vidéo.').check();
  await panel.getByRole('button', { name: 'Enregistrer le brouillon vidéo', exact: true }).click();
  await expect(panel.locator('.catalogue-hint').first()).toContainText('brouillon', { ignoreCase: true });
}
test('vidéo film : aperçu privé, brouillon, validation explicite, modification et retrait', async ({ page }) => {
  await admin(page); const panel = page.locator('#admin-film-video');
  await expect(panel).toContainText('Aucune vidéo configurée');
  await panel.getByLabel('Lien vidéo Vidmoly').fill(URL1); await panel.getByLabel('Je suis autorisé à diffuser cette vidéo.').check();
  const before = JSON.stringify([...db.data]);
  await panel.getByRole('button', { name: 'Vérifier le lecteur', exact: true }).click();
  await expect(panel.locator('iframe')).toHaveAttribute('src', URL1); expect(JSON.stringify([...db.data])).toBe(before);
  await save(panel, URL1);
  expect((await store.get(film.id)).entry.video.approved).toBeUndefined();
  await panel.getByRole('button', { name: 'Valider la vidéo', exact: true }).click();
  await expect(panel.locator('.catalogue-hint').first()).toContainText('Vidéo validée');
  await save(panel, URL2);
  expect((await store.get(film.id)).entry.video.approved.embedURL).toBe(URL1);
  await panel.getByRole('button', { name: 'Valider la vidéo', exact: true }).click();
  await expect.poll(async () => (await store.get(film.id)).entry.video.approved.embedURL).toBe(URL2);
  await panel.getByRole('button', { name: 'Retirer la vidéo', exact: true }).click();
  await expect(panel).toContainText('Aucune vidéo configurée');
});

test('vidéo épisode : édition dans la bonne saison et suppression indépendante', async ({ page }) => {
  await admin(page, 'Stranger Things');
  await page.getByRole('button', { name: 'Gérer les épisodes', exact: true }).first().click();
  const one = page.locator('[data-video-episode="1"]'), two = page.locator('[data-video-episode="2"]');
  await save(one, URL1); await one.getByRole('button', { name: 'Valider la vidéo', exact: true }).click(); await expect(one).toContainText('Vidéo validée');
  await save(two, URL2); await two.getByRole('button', { name: 'Valider la vidéo', exact: true }).click(); await expect(two).toContainText('Vidéo validée');
  await save(one, URL2); await one.getByRole('button', { name: 'Valider la vidéo', exact: true }).click();
  await expect.poll(async () => (await store.season(series.id, 1)).episodes[0].video.approved.embedURL).toBe(URL2);
  await one.getByRole('button', { name: 'Retirer la vidéo', exact: true }).click(); await expect(one).toContainText('Aucune vidéo configurée');
  expect((await store.season(series.id, 1)).episodes[1].video.approved.embedURL).toBe(URL2);
  await page.getByRole('button', { name: 'Gérer les épisodes', exact: true }).nth(1).click(); await expect(one).toContainText('Aucune vidéo configurée');
});

test('lecture : aucun contact tiers avant clic, iframe isolée et fermeture', async ({ page }) => {
  await setupVideo(film.id); const requests = []; page.on('request', request => { if (request.url().startsWith('https://vidmoly.org/')) requests.push(request.url()); });
  await page.goto(base + '/titre.html?id=' + film.id);
  const player = page.locator('#video-section'); await expect(player.getByRole('button', { name: 'Regarder', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0); await expect(player.locator('iframe')).toHaveCount(0);
  await player.getByRole('button', { name: 'Regarder', exact: true }).click();
  await expect(player.locator('iframe')).toHaveAttribute('src', URL1);
  await expect(player.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  await player.getByRole('button', { name: 'Fermer le lecteur' }).click(); await expect(player.locator('iframe')).toHaveCount(0);
});

test('lecture épisodes : bon lecteur, réponses lentes ignorées et aucune source pour épisode absent', async ({ page }) => {
  await setupVideo(series.id, { season: 1, episode: 1 }, URL1); await setupVideo(series.id, { season: 1, episode: 2 }, URL2);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/playback?season=1&episode=1', async route => { await gate; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: true, embedURL: URL1 }) }).catch(() => {}); });
  try {
    await page.goto(base + '/titre.html?id=' + series.id); await expect(page.locator('#episode-select option')).toHaveCount(2);
    await page.locator('#episode-select').selectOption('2'); const video = page.locator('#video-section');
    await expect(video.getByRole('button', { name: 'Regarder', exact: true })).toBeVisible(); await video.getByRole('button', { name: 'Regarder', exact: true }).click();
    await expect(video.locator('iframe')).toHaveAttribute('src', URL2); release(); await expect(video.locator('iframe')).toHaveAttribute('src', URL2);
    await page.locator('#season-select').selectOption('2'); await expect(video).toContainText('Aucune vidéo n’est disponible'); await expect(video.locator('iframe')).toHaveCount(0);
    await page.locator('#season-select').selectOption('1'); await page.locator('#episode-select').selectOption('2'); await expect(video.locator('iframe')).toHaveAttribute('src', URL2);
  } finally { release(); }
});

test('vidéo : absence, panne API, reprise et contenu masqué sans casser les détails', async ({ page }) => {
  await page.goto(base + '/titre.html?id=' + film.id); const video = page.locator('#video-section'); await expect(video).toContainText('Aucune vidéo n’est disponible');
  await page.route('**/playback', route => route.abort()); await video.getByRole('button', { name: 'Réessayer', exact: true }).click(); await expect(video).toContainText('ne peut pas être vérifiée');
  await expect(page.locator('#title-overview')).toBeVisible(); await page.unroute('**/playback'); await setupVideo(film.id);
  await video.getByRole('button', { name: 'Réessayer', exact: true }).click(); await expect(video.getByRole('button', { name: 'Regarder', exact: true })).toBeVisible();
  const current = await store.get(film.id); await store.patch(film.id, current.entry.version, ADMIN_UID, { status: 'hidden' });
  await video.getByRole('button', { name: 'Regarder', exact: true }).click(); await expect(video).toContainText('n’est plus publié'); await expect(video.locator('iframe')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#title-content')).toBeHidden();
});

test('vidéo admin : droits obligatoires, URL malveillante refusée et champs préservés en erreur', async ({ page }) => {
  await admin(page); const panel = page.locator('#admin-film-video');
  await panel.getByLabel('Lien vidéo Vidmoly').fill(URL1); await panel.getByRole('button', { name: 'Enregistrer le brouillon vidéo', exact: true }).click(); await expect(panel).toContainText('Confirmez votre autorisation');
  await panel.getByLabel('Je suis autorisé à diffuser cette vidéo.').check(); await panel.getByLabel('Lien vidéo Vidmoly').fill('https://evil.invalid/embed-aaaaaaaaaaaa.html');
  await panel.getByRole('button', { name: 'Vérifier le lecteur', exact: true }).click(); await expect(panel).toContainText('Utilisez un lien'); await expect(panel.locator('iframe')).toHaveCount(0);
  expect((await store.get(film.id)).entry.video).toBeUndefined(); await expect(panel.getByLabel('Lien vidéo Vidmoly')).toHaveValue('https://evil.invalid/embed-aaaaaaaaaaaa.html');
});

test('vidéo mobile : lecteur responsive, erreur explicite et aperçu fermé avec la fenêtre admin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setupVideo(film.id);
  await page.goto(base + '/titre.html?id=' + film.id); const video = page.locator('#video-section'); await video.getByRole('button', { name: 'Regarder', exact: true }).click();
  const frame = video.locator('iframe'); await expect(frame).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await frame.boundingBox(); expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 1);
  await frame.evaluate(element => element.dispatchEvent(new Event('error'))); await expect(video).toContainText('Le lecteur ne peut pas être chargé'); await expect(page.locator('#title-overview')).toBeVisible();
  await admin(page); const panel = page.locator('#admin-film-video'); await panel.getByRole('button', { name: 'Vérifier le lecteur', exact: true }).click(); await expect(panel.locator('iframe')).toBeVisible();
  expect(await page.locator('#admin-content-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#admin-editor-close').click(); await expect(panel.locator('iframe')).toHaveCount(0);
});

test('lecteur : redirection tierce bloquée, pas de faux succès au load et sortie externe sûre', async ({ page }) => {
  await setupVideo(film.id); await page.goto(base + '/titre.html?id=' + film.id);
  const video = page.locator('#video-section'); await video.getByRole('button', { name: 'Regarder', exact: true }).click();
  await expect(video.locator('iframe')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'frame-src', blockedURI: 'https://cdn.staticmoly.me' })));
  await expect(video).toContainText('sa redirection est bloqué'); await expect(video.locator('iframe')).toHaveCount(0);
  const external = video.getByRole('link', { name: 'Essayer sur Vidmoly' });
  await expect(external).toHaveAttribute('href', URL1); await expect(external).toHaveAttribute('rel', 'noopener noreferrer'); await expect(external).toHaveAttribute('target', '_blank');
  await expect(page.locator('#title-overview')).toBeVisible();
});
