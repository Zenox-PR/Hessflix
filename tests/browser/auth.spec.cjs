const { test, expect } = require('@playwright/test');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createMovixServer } = require('../../server.cjs');
const { createTestFirestore,seedApprovedLegacy } = require('../fixtures/catalogue-db.cjs');
const approvedTestCatalogue=seedApprovedLegacy(createTestFirestore());
let server, base, profilesDirectory;
const profileAuth = { async verifyIdToken(value, revoked) { if (value !== 'regular-test-token-123456' || revoked !== true) throw new Error('Invalid token'); return { uid: 'test-user', admin: false }; } };
const appStub = 'export const getApps=()=>[]; export const initializeApp=()=>({});';
const authStub = `
let listener=()=>{};
function hydrate(data){return data ? {...data, async getIdTokenResult(){return {claims:{admin:false}};}, async getIdToken(){return 'regular-test-token-123456';}} : null;}
const auth={currentUser:hydrate(JSON.parse(localStorage.getItem('test-user')||'null'))};
function save(user){auth.currentUser=hydrate(user);if(user)localStorage.setItem('test-user',JSON.stringify(user));else localStorage.removeItem('test-user');listener(auth.currentUser);}
const user=provider=>({uid:'test-user',displayName:provider==='google.com'?'Profil Google':'',email:'test@example.com',photoURL:'',providerData:[{providerId:provider}]});
export const getAuth=()=>auth;
export class GoogleAuthProvider{setCustomParameters(){}}
export function onIdTokenChanged(instance,callback){listener=callback;queueMicrotask(()=>callback(instance.currentUser));return ()=>{listener=()=>{};};}
export async function signInWithPopup(){save(user('google.com'));}
export async function signInWithEmailAndPassword(instance,email,password){if(password==='incorrect')throw {code:'auth/invalid-credential'};if(password==='network-error')throw {code:'auth/network-request-failed'};save(user('password'));}
export async function createUserWithEmailAndPassword(){const created=user('password');save(created);return {user:auth.currentUser};}
export async function updateProfile(current,data){if(('photoURL' in data && window.testAvatarSaveFails)||('displayName' in data && window.testNameSaveFails))throw {code:'auth/network-request-failed'};Object.assign(current,data);save(current);}
export async function sendPasswordResetEmail(instance,email){window.testReset=email;}
export async function signOut(){save(null);}
`;
const ready = page => page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready');
async function login(page, password = 'test-password-123') {
  await page.goto(base + '/connexion.html'); await ready(page);
  await page.locator('#login-email').fill('test@example.com');
  await page.locator('#login-password').fill(password);
  await page.locator('.auth-submit').click();
}
test.beforeAll(async () => {
  profilesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'movix-viewer-browser-'));
  server = createMovixServer({ getAuth: () => profileAuth, profilesDirectory, getFirestore:async()=>approvedTestCatalogue }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  // Le contrôle d'origine doit correspondre au port aléatoire utilisé par le navigateur.
  await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ origin: base, getAuth: () => profileAuth, profilesDirectory, getFirestore:async()=>approvedTestCatalogue });
  server.listen(Number(new URL(base).port), '127.0.0.1'); await once(server, 'listening');
});
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (profilesDirectory && path.dirname(profilesDirectory) === path.resolve(os.tmpdir()) && path.basename(profilesDirectory).startsWith('movix-viewer-browser-')) fs.rmSync(profilesDirectory, { recursive: true, force: true });
});
test.beforeEach(async ({ context, page }) => {
  for(const key of approvedTestCatalogue.data.keys())if(key.startsWith('viewerAccounts/test-user'))approvedTestCatalogue.data.delete(key);
  fs.rmSync(path.join(profilesDirectory, createHash('sha256').update('test-user').digest('hex') + '.json'), { force: true });
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appStub }));
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authStub }));
  page.testErrors = []; page.on('pageerror', error => page.testErrors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.testErrors).toEqual([]); });
test('erreur de connexion, mot de passe effacé, réinitialisation et panne réseau', async ({ page }) => {
  await login(page, 'incorrect');
  await expect(page.locator('#login-message')).toContainText('Connexion impossible');
  await expect(page.locator('#login-password')).toHaveValue('');
  await page.locator('#reset-password').click();
  await page.waitForFunction(() => window.testReset === 'test@example.com');
  await expect(page.locator('#login-message')).toContainText('Si un compte');
  await login(page, 'network-error');
  await expect(page.locator('#login-message')).toContainText('Connexion réseau impossible');
  await expect(page.locator('.auth-submit')).toBeEnabled();
});
test('inscription, confirmation, nom et persistance après rechargement', async ({ page }) => {
  await page.goto(base + '/connexion.html'); await ready(page);
  await page.locator('[data-auth-mode="signup"]').click();
  await page.locator('#login-email').fill('test@example.com');
  await page.locator('#signup-name').fill('Mon profil test');
  await page.locator('#login-password').fill('test-password-123');
  await page.locator('#signup-confirm').fill('different-password');
  await page.locator('.auth-submit').click();
  await expect(page.locator('#login-message')).toContainText('identiques');
  await page.locator('#signup-confirm').fill('test-password-123');
  await page.locator('.auth-submit').click(); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.locator('.account-trigger').click();
  await expect(page.locator('.account-name')).toHaveText('Mon profil test');
  await page.reload(); await ready(page);
  await expect(page.locator('.account-trigger')).toBeVisible();
});
test('connexion email et déconnexion serveur puis Firebase', async ({ page, context }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await context.addCookies([{ name: 'movix_admin', value: 'stale-session', url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.locator('.account-trigger').click(); await page.locator('.account-logout').click();
  await expect(page.locator('.account-disconnected')).toBeVisible();
  expect((await context.cookies()).some(cookie => cookie.name === 'movix_admin')).toBe(false);
  await page.reload(); await ready(page); await expect(page.locator('.account-disconnected')).toBeVisible();
});
test('Google respecte la page de retour et affiche le fournisseur', async ({ page }) => {
  await page.goto(base + '/connexion.html?retour=netflix.html'); await ready(page);
  await page.locator('#google-signin').click(); await page.waitForURL(base + '/netflix.html'); await ready(page);
  await page.locator('.account-trigger').click();
  await expect(page.locator('.account-provider')).toHaveText('Connecté avec Google');
});
test('échec serveur au logout : Firebase fermé, avertissement persistant et reprise', async ({ page, context }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.route('**/api/admin/session', route => route.fulfill({ status: 503, body: '{}' }));
  await context.addCookies([{ name: 'movix_admin', value: 'stale-session', url: base, httpOnly: true, sameSite: 'Strict' }]);
  await page.locator('.account-trigger').click(); await page.locator('.account-logout').click();
  await expect(page.locator('.account-disconnected')).toBeVisible();
  await expect(page.locator('#server-session-warning')).toContainText('reste à confirmer');
  expect((await context.cookies()).some(cookie => cookie.name === 'movix_admin')).toBe(true);
  await page.reload(); await ready(page);
  await expect(page.locator('#server-session-warning')).toBeVisible();
  await page.unroute('**/api/admin/session');
  await page.locator('#server-session-warning button').click();
  await expect(page.locator('#server-session-warning')).toHaveCount(0);
  expect((await context.cookies()).some(cookie => cookie.name === 'movix_admin')).toBe(false);
});
test('SDK indisponible : formulaire désactivé et diagnostic visible', async ({ page, context }) => {
  await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.abort());
  await page.goto(base + '/connexion.html');
  await page.waitForFunction(() => window.MovixAuthStatus?.state === 'error');
  await expect(page.locator('.auth-submit')).toBeDisabled();
  await expect(page.locator('#login-message')).toContainText('indisponible');
});
test('mobile, ancien aperçu et ouverture fichier sans authentification fictive', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await page.evaluate(() => sessionStorage.setItem('movix-profile-preview', 'true'));
  await page.reload(); await ready(page); await expect(page.locator('.account-disconnected')).toBeVisible();
  await page.goto(base + '/connexion.html'); await ready(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-auth-mode="signup"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(pathToFileURL(path.resolve(__dirname, '../../connexion.html')).href);
  await page.waitForFunction(() => window.MovixAuthStatus?.state === 'unsupported-origin');
  await expect(page.locator('#google-signin')).toBeDisabled();
});
test('accueil : recherche et filtres combinés dans les deux sens, remise à zéro', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await expect(page.locator('#catalogue')).toHaveCount(0);
  await expect(page.locator('#resultats')).toBeHidden();
  await expect(page.locator('#continue-cards .continue-card')).toHaveCount(4);
  expect(await page.evaluate(() => document.querySelector('#suggestions-demo').compareDocumentPosition(document.querySelector('#discovery-sections')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await page.locator('[data-filter="Film"]').click();
  await page.locator('#search').fill('Severance');
  await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(0);
  await page.locator('[data-filter="Série"]').click();
  await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
  await expect(page.locator('#catalogue-cards')).toContainText('Severance');
  await page.locator('[data-filter="Film"]').click();
  await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(0);
  await expect(page.locator('#search')).toHaveValue('Severance');
  await page.locator('[data-filter="Tous"]').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#resultats')).toBeHidden();
  await page.locator('#search').fill('Interstellar');
  await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
  await page.locator('#catalogue-cards .card-open').focus(); await page.keyboard.press('Enter');
  await page.waitForURL(/\/titre\.html\?id=movie-tt0816692$/);
  await expect(page.locator('#title-name')).toHaveText('Interstellar');
});
test('catalogue : balises dans les données rendues en texte, aucun HTML injecté', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await page.evaluate(() => {
    const injected = { title: '<img src=x onerror=alert(1)>', kind: 'Film', year: '<svg>', rating: '<b>9</b>', poster: 'url(https://attacker.invalid/x)', word: '<script>x</script>' };
    renderCatalogue([injected]); showDetails(injected);
  });
  await expect(page.locator('#catalogue-cards h3')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#catalogue-cards img, #modal-content img, #modal-content svg, #catalogue-cards script')).toHaveCount(0);
  await expect(page.locator('#modal-content h2')).toHaveText('<img src=x onerror=alert(1)>');
});

test('fiche film : service officiel, source, retour et reprise sans progression fictive', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await page.locator('#continue-cards .continue-card').nth(1).click();
  await page.waitForURL(/\/titre\.html\?id=movie-tt0816692$/);
  await expect(page.locator('#title-name')).toHaveText('Interstellar');
  const official = page.locator('#watch-options a').first();
  await expect(official).toHaveAttribute('href', /^https:\/\/(?:www\.)?netflix\.com\//);
  await expect(page.locator('#episode-section')).toBeHidden();
  await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.locator('.title-header nav a').click();
  await expect(page.locator('#continue-hint')).toContainText('récemment');
  await expect(page.locator('#continue-cards .continue-card').first()).toContainText('Interstellar');
});

test('fiche série : saisons et épisodes réels, choix conservé et disponibilité nuancée', async ({ page }) => {
  await page.goto(base + '/titre.html?id=series-2993'); await ready(page);
  await expect(page.locator('#title-name')).toHaveText('Stranger Things');
  await expect(page.locator('#episode-section')).toBeVisible();
  await expect(page.locator('#season-select option')).not.toHaveCount(0);
  await page.locator('#season-select').selectOption('2');
  await expect(page.locator('#episode-list .episode-card')).not.toHaveCount(0);
  await page.locator('#episode-list .episode-card').nth(1).click();
  await expect(page.locator('#episode-selected')).toContainText('Saison 2, épisode 2');
  await expect(page.locator('#episode-list .episode-select-card').nth(1)).toHaveAttribute('aria-pressed','true');
  await page.reload(); await ready(page);
  await expect(page.locator('#season-select')).toHaveValue('2');
  await expect(page.locator('#episode-selected')).toContainText('Saison 2, épisode 2');
  await expect(page.locator('#title-sources a')).toContainText(['Source de la fiche ↗','Disponibilité en France ↗','Épisodes : TMDB ↗']);
  await expect(page.locator('.episode-section .title-caveat')).toContainText('ne garantissent pas la disponibilité');
});

test('fiche série : sélecteurs, frontière entre saisons et limites de navigation', async ({ page }) => {
  await page.goto(base + '/titre.html?id=series-2993'); await ready(page);
  await expect(page.locator('#episode-prev')).toBeDisabled();
  await page.locator('#episode-next').click();
  await expect(page.locator('#episode-select')).toHaveValue('2');
  await page.locator('#season-strip button[data-season="2"]').click();
  await expect(page.locator('#season-select')).toHaveValue('2');
  await expect(page.locator('#episode-select')).toHaveValue('1');
  await page.locator('#episode-prev').click();
  await expect(page.locator('#season-select')).toHaveValue('1');
  const lastFirstSeason = await page.locator('#episode-select option').last().getAttribute('value');
  await expect(page.locator('#episode-select')).toHaveValue(lastFirstSeason);
  await page.locator('#episode-next').click();
  await expect(page.locator('#episode-selected')).toContainText('Saison 2, épisode 1');
  await page.locator('#episode-select').selectOption('3');
  await expect(page.locator('#episode-list .episode-select-card[aria-pressed="true"]')).toHaveAttribute('data-number', '3');
  const lastSeason = await page.locator('#season-select option').last().getAttribute('value');
  await page.locator('#season-select').selectOption(lastSeason);
  await expect(page.locator('#episode-list')).not.toHaveAttribute('aria-busy','true');
  const lastEpisode = await page.locator('#episode-select option').last().getAttribute('value');
  await page.locator('#episode-select').selectOption(lastEpisode);
  await expect(page.locator('#episode-next')).toBeDisabled();
});

test('fiche animée : guide réel et absence de débordement sur mobile et tablette', async ({ page }) => {
  await page.goto(base + '/titre.html?id=series-55138'); await ready(page);
  await expect(page.locator('#title-name')).toHaveText('Arcane');
  await expect(page.locator('#title-kind')).toHaveText('Série animée');
  await expect(page.locator('#episode-section')).toBeVisible();
  await expect(page.locator('#related-list a')).not.toHaveCount(0);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#episode-select')).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.episode-card').first().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await expect(page.locator('video,iframe')).toHaveCount(0);
});

test('fiche série : guide manquant expliqué sans faux épisodes', async ({ page }) => {
  await page.route('**/api/catalogue/series-2993',async route=>{const response=await route.fetch();const data=await response.json();data.item.tmdbSeasons=[];data.item.episodeCount=0;data.item.seasonCount=0;await route.fulfill({response,body:JSON.stringify(data)});});
  await page.goto(base + '/titre.html?id=series-2993'); await ready(page);
  await expect(page.locator('#title-content')).toBeVisible();
  await expect(page.locator('#episode-empty')).toBeVisible();
  await expect(page.locator('.episode-toolbar')).toBeHidden();
  await expect(page.locator('#episode-list .episode-card')).toHaveCount(0);
  await expect(page.locator('#watch-options a').first()).toBeVisible();
});

test('fiche : synopsis long accessible, texte sûr et affiche manquante', async ({ page }) => {
  // Données longues uniquement dans ce scénario de test ; aucun catalogue livré n’est modifié.
  const longOverview = '<img src=x onerror=alert(1)> ' + 'Une histoire à découvrir. '.repeat(35);
  await page.route('**/api/catalogue/series-2993',async route=>{const response=await route.fetch();const data=await response.json();data.item.overview=longOverview;await route.fulfill({response,body:JSON.stringify(data)});});
  await page.route('**/assets/discovery/series-2993.*', route => route.abort());
  await page.goto(base + '/titre.html?id=series-2993'); await ready(page);
  await expect(page.locator('#title-overview')).toHaveText(longOverview);
  await expect(page.locator('#title-overview img')).toHaveCount(0);
  await expect(page.locator('#title-art .art-fallback')).toHaveText('Stranger Things');
  await expect(page.locator('#overview-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#overview-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#overview-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#title-overview')).not.toHaveClass(/is-collapsed/);
  await page.locator('#overview-toggle').click();
  await expect(page.locator('#title-overview')).toHaveClass(/is-collapsed/);
});

test('fiche : panne du catalogue publié expliquée avec possibilité de réessayer', async ({ page }) => {
  await page.route('**/catalogue-data.js', route => route.abort());
  await page.route('**/api/catalogue/**', route => route.abort());
  await page.goto(base + '/titre.html?id=series-2993');
  await expect(page.locator('#title-loading')).toBeHidden();
  await expect(page.locator('#title-not-found')).toBeVisible();
  await expect(page.locator('#title-error-heading')).toContainText('pas pu être chargée');
  await expect(page.locator('#title-reload')).toBeVisible();
  await expect(page.locator('#title-content')).toBeHidden();
});

test('fiche : identifiant inconnu rejeté et lien de recherche sans offre vérifiée', async ({ page }) => {
  await page.goto(base + '/titre.html?id=../../server.cjs');
  await expect(page.locator('#title-not-found')).toBeVisible();
  await expect(page.locator('#title-content')).toBeHidden();
  await page.goto(base + '/titre.html?id=movie-tt0111161');
  await expect(page.locator('#title-name')).toHaveText('Les Évadés');
  await expect(page.locator('#watch-options a')).toHaveAttribute('href', /^https:\/\/www\.justwatch\.com\/fr\/recherche\?q=/);
  await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('fiche : la connexion revient au titre demandé sans redirection arbitraire', async ({ page }) => {
  await page.goto(base + '/titre.html?id=series-2993'); await ready(page);
  await page.locator('[data-account-slot] .account-disconnected').click();
  await page.waitForURL(/\/connexion\.html\?retour=/);
  await page.locator('#login-email').fill('test@example.com');
  await page.locator('#login-password').fill('test-password-123');
  await page.locator('.auth-submit').click();
  await page.waitForURL(base + '/titre.html?id=series-2993');
  await expect(page.locator('#title-name')).toHaveText('Stranger Things');
  await page.goto(base + '/connexion.html?retour=https%3A%2F%2Fevil.invalid');
  await expect(page.locator('#login-back')).toHaveAttribute('href','index.html');
});

test('découverte : neuf sections, affiches locales et deux vrais Top 10 décroissants', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await expect(page.locator('.discovery-row')).toHaveCount(9);
  await expect(page.locator('#tendances .discovery-card')).toHaveCount(12);
  expect(await page.locator('#sagas .saga-card').count()).toBeGreaterThan(0);
  for (const id of ['films-populaires','series-populaires']) {
    const row = page.locator('#' + id);
    await expect(row.locator('.rank-number')).toHaveText(Array.from({length:10},(_,i) => String(i+1)));
    const scores = await row.locator('.discovery-card').evaluateAll(cards => cards.map(card => Number(card.dataset.rating.replace(',','.'))));
    expect(scores).toEqual([...scores].sort((a,b) => b-a));
    expect(await row.locator('.kind-tag').allTextContents()).toEqual(Array(10).fill(id === 'films-populaires' ? 'Film' : 'Série'));
  }
  await page.locator('#tendances').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#tendances img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('découverte : détails au survol, étoile et favoris persistants sans faux stockage cloud', async ({ page }) => {
  await page.goto(base + '/'); await ready(page); await page.mouse.move(0,0);
  const card = page.locator('#tendances .discovery-card').first();
  await expect(card.locator('.media-info')).toHaveCSS('opacity','0');
  await card.hover(); await expect(card.locator('.media-info')).toHaveCSS('opacity','1');
  await expect(card.locator('.card-overview')).not.toBeEmpty();
  await expect(card.locator('.card-year')).toContainText(/20\d{2}/);
  const title = await card.locator('h3').textContent();
  await card.locator('.favorite-button').click(); await expect(card.locator('.favorite-button')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#discovery-notice')).toContainText('sur cet appareil');
  await page.reload(); await ready(page);
  await expect(page.locator('#tendances .favorite-button').first()).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-local-favorites]').click();
  await expect(page.locator('#catalogue-cards .discovery-card')).toHaveCount(1);
  await expect(page.locator('#catalogue-cards h3')).toHaveText(title);
  await page.locator('#catalogue-cards .favorite-button').click();
  await expect(page.locator('#catalogue-empty')).toBeVisible();
});

test('découverte : saga, genre, remise à zéro et suggestion ouvrent les bonnes fiches', async ({ page }) => {
  await page.goto(base + '/'); await ready(page);
  await page.getByRole('button',{name:'Explorer la saga Harry Potter',exact:true}).click();
  await expect(page.locator('#catalogue-selection')).toHaveText('Harry Potter');
  await expect(page.locator('#catalogue-cards .discovery-card')).toHaveCount(2);
  expect((await page.locator('#catalogue-cards h3').allTextContents()).every(title => title.includes('Harry Potter'))).toBe(true);
  await page.locator('[data-filter="Tous"]').click();
  await page.getByRole('button',{name:'Tout voir : Thrillers & mystères',exact:true}).click();
  await expect(page.locator('#catalogue-selection')).toHaveText('Thriller');
  expect(await page.locator('#catalogue-cards .discovery-card').count()).toBeGreaterThan(5);
  await page.locator('[data-filter="Tous"]').click(); await page.locator('.surprise-button').click();
  await expect(page.locator('#details-modal')).toBeVisible();
  await expect(page.locator('.detail-summary')).not.toBeEmpty();
  await expect(page.locator('.detail-source')).toHaveAttribute('href',/^https:\/\/(www\.)?(imdb\.com|tvmaze\.com|justwatch\.com|themoviedb\.org)\//);
  await page.keyboard.press('Escape'); await expect(page.locator('#details-modal')).not.toBeVisible();
});

test('découverte : flèches, glissement souris et format mobile sans débordement', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto(base + '/'); await ready(page);
  const rail = page.locator('#films-populaires-rail');
  await page.getByRole('button',{name:'Suivant : Films populaires · Top 10',exact:true}).click();
  await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
  await page.getByRole('button',{name:'Précédent : Films populaires · Top 10',exact:true}).click();
  await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeLessThanOrEqual(4);
  const box = await rail.boundingBox();
  await page.mouse.move(box.x+360,box.y+120); await page.mouse.down(); await page.mouse.move(box.x+90,box.y+120,{steps:12}); await page.mouse.up();
  await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
  await expect(page.locator('#details-modal')).not.toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#films-populaires .rank-number')).toHaveCount(10);
  await page.getByRole('button',{name:'Suivant : Films populaires · Top 10',exact:true}).click();
  expect(await rail.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
});

test('découverte : rotation automatique visible, suspendue au survol et mouvement réduit respecté', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'no-preference'}); await page.clock.install();
  await page.goto(base + '/'); await ready(page);
  const rail = page.locator('#tendances-rail'); await rail.scrollIntoViewIfNeeded(); await page.mouse.move(0,0);
  await page.clock.runFor(400);
  await page.clock.fastForward(18000); await page.clock.runFor(800);
  await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeGreaterThan(20);
  await page.locator('#tendances').hover();
  const atHover = await rail.evaluate(node => node.scrollLeft);
  await page.clock.fastForward(18000); await page.clock.runFor(400);
  expect(await rail.evaluate(node => node.scrollLeft)).toBe(atHover);
  await page.emulateMedia({reducedMotion:'reduce'}); await page.mouse.move(0,0);
  const reducedPosition = await rail.evaluate(node => node.scrollLeft);
  await page.clock.fastForward(36000); await page.clock.runFor(400);
  expect(await rail.evaluate(node => node.scrollLeft)).toBe(reducedPosition);
});

for(const id of ['netflix','prime-video','paramount','disney','marvel']) {
  test('univers '+id+' : titres vérifiés uniquement, Top 10, survol et mobile', async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/'+id+'.html');await ready(page);
    await expect(page.locator('#availability-date')).toContainText('France');
    const valid=await page.evaluate(id=>{
      const data=window.MovixPlatformCatalogue;const ids=data.providers[id].itemIds;
      const rendered=[...document.querySelectorAll('.discovery-card')].map(card=>card.dataset.mediaId);
      return rendered.every(value=>ids.includes(value)) && data.items.filter(item=>ids.includes(item.id)).every(item=>item.availability.some(offer=>window.MovixModel.validAvailability(offer)&&offer.platform===(id==='marvel'?'disney':id)));
    },id);expect(valid).toBe(true);
    for(const section of ['films-populaires','series-populaires']) {
      await expect(page.locator('#'+section+' .rank-number')).toHaveText(Array.from({length:10},(_,i)=>String(i+1)));
      const scores=await page.locator('#'+section+' .discovery-card').evaluateAll(cards=>cards.map(card=>Number(card.dataset.rating.replace(',','.'))));expect(scores).toEqual([...scores].sort((a,b)=>b-a));
    }
    const card=page.locator('#tendances .discovery-card').first();await card.hover();
    await expect(card.locator('.media-info')).toHaveCSS('opacity','1');
    await expect.poll(()=>card.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await card.locator('.card-open').click();await page.waitForURL(/\/titre\.html\?id=/);
    await expect(page.locator('#title-name')).not.toBeEmpty();
    await expect(page.locator('#watch-intro')).toContainText('France');
    await expect(page.locator('#watch-options a')).not.toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.goBack();await ready(page);
    if(id==='marvel') await expect(page.locator('#universe-description')).toContainText('n’est pas un service');
  });
}

test('univers : recherche combinée, favoris communs aux plateformes et à l’accueil',async({page})=>{
  await page.goto(base+'/netflix.html');await ready(page);
  await page.locator('[data-kind="Série"]').click();await page.locator('#universe-search').fill('The Truman Show');
  await expect(page.locator('#universe-catalogue .discovery-card')).toHaveCount(0);
  await page.locator('[data-kind="Film"]').click();await expect(page.locator('#universe-catalogue .discovery-card')).toHaveCount(1);
  await page.locator('#universe-catalogue .favorite-button').click();
  await page.goto(base+'/paramount.html');await ready(page);await page.locator('#universe-search').fill('The Truman Show');
  await expect(page.locator('#universe-catalogue .favorite-button')).toHaveAttribute('aria-pressed','true');
  await page.goto(base+'/index.html');await ready(page);await page.locator('[data-local-favorites]').click();
  await expect(page.locator('#catalogue-cards .discovery-card')).toHaveCount(1);await expect(page.locator('#catalogue-cards h3')).toHaveText('The Truman Show');
});

test('univers : liens étrangers, location et HTML injecté refusés dans une fiche',async({page})=>{
  await page.goto(base+'/prime-video.html');await ready(page);
  await page.evaluate(()=>window.MovixBrowse.showDetails({id:'malformed',title:'<img src=x onerror=alert(1)>',kind:'Film',year:'2024',rating:'8,0',poster:'url(https://attacker.invalid/x)',image:'https://attacker.invalid/image.jpg',overview:'<script>test</script>',availability:[{platform:'prime-video',country:'US',type:'subscription',sourceURL:'https://www.justwatch.com/fr/film/test',watchURL:'https://app.primevideo.com/detail/test',checkedAt:'2026-10-23'}]}));
  await expect(page.locator('#dialog-title')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#title-dialog img,#title-dialog script,#title-dialog .watch-offer')).toHaveCount(0);
});
test('CSP : aucun script inline exécuté, aucune violation sur le parcours local', async ({ page }) => {
  await page.addInitScript(() => { window.testCsp = []; document.addEventListener('securitypolicyviolation', event => window.testCsp.push(event.violatedDirective)); });
  await page.goto(base + '/'); await ready(page);
  await page.locator('.platform-card[href="netflix.html"]').click(); await ready(page);
  await page.locator('#featured-title').click(); await page.waitForURL(/\/titre\.html\?id=/);
  await expect(page.locator('#title-name')).not.toBeEmpty();
  expect(await page.evaluate(() => window.testCsp)).toEqual([]);
  await page.evaluate(() => { window.testInlineExecuted = false; const script = document.createElement('script'); script.textContent = 'window.testInlineExecuted = true'; document.body.append(script); });
  await page.waitForFunction(() => window.testCsp.includes('script-src-elem'));
  expect(await page.evaluate(() => window.testInlineExecuted)).toBe(false);
});

test('avatars : menu limité, six catégories, sélection persistante et suppression neutre', async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.goto(base + '/compte.html#profil'); await ready(page);
  await page.locator('#profile-avatar-trigger').click();
  await expect(page.locator('#profile-avatar-menu [role="menuitem"]')).toHaveCount(2);
  await expect(page.locator('#change-avatar')).toHaveText('Changer d’avatar');
  await expect(page.locator('#remove-avatar')).toBeDisabled();
  await page.locator('#change-avatar').click();
  await expect(page.locator('#avatar-dialog')).toBeVisible();
  await expect(page.locator('#avatar-category-tabs [role="tab"]')).toHaveText(['Crunchyroll', 'Disney+', 'HBO', 'Netflix', 'Prime Video', 'Classiques']);
  await expect(page.locator('.avatar-group h3').first()).toHaveText('L’Attaque des Titans');
  const first = page.locator('.avatar-option').first();
  const photoURL = await first.getAttribute('data-photo-url');
  const source = await first.locator('img').getAttribute('src');
  await expect(first.locator('img')).toBeVisible();
  await page.waitForFunction(() => { const image = document.querySelector('.avatar-option img'); return image.complete && image.naturalWidth > 0; });
  await first.click();
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', source);
  await expect(page.locator('.account-trigger img')).toHaveAttribute('src', source);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-user')).photoURL)).toBe(photoURL);
  await page.reload(); await ready(page);
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', source);
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  await expect(page.locator('.avatar-option[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('#close-avatar-dialog').click();
  await page.goto(base + '/netflix.html'); await ready(page);
  await expect(page.locator('.account-trigger img')).toHaveAttribute('src', source);
  await page.goto(base + '/compte.html#profil'); await ready(page);
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#remove-avatar').click();
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', 'assets/avatar-neutral.svg');
  await expect(page.locator('.account-trigger img')).toHaveAttribute('src', 'assets/avatar-neutral.svg');
  await expect(page.locator('#avatar-profile-status')).toContainText('Avatar supprimé');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-user')).photoURL)).toBeNull();
  await page.reload(); await ready(page);
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', 'assets/avatar-neutral.svg');
});

test('avatars : refus réseau sans faux succès, reprise et chargement local des images', async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.goto(base + '/compte.html'); await ready(page);
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  await page.locator('[role="tab"][data-category="netflix"]').click();
  const chosen = page.locator('.avatar-option').first();
  const source = await chosen.locator('img').getAttribute('src');
  await page.evaluate(() => { window.testAvatarSaveFails = true; });
  await chosen.click();
  await expect(page.locator('#avatar-save-status')).toContainText('n’a pas pu être enregistré');
  await expect(page.locator('#avatar-dialog')).toBeVisible();
  await expect(chosen).toBeEnabled();
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', 'assets/avatar-neutral.svg');
  await page.evaluate(() => { window.testAvatarSaveFails = false; });
  await chosen.click();
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  await expect(page.locator('#account-page-avatar')).toHaveAttribute('src', source);
  await page.waitForFunction(() => { const image = document.querySelector('#account-page-avatar'); return image.complete && image.naturalWidth > 0; });
});

test('avatars : mobile, catégories au clavier, fermeture Échap et visiteur', async ({ page }) => {
  await page.goto(base + '/compte.html'); await ready(page);
  await expect(page.locator('#profile-avatar-trigger')).toBeDisabled();
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.goto(base + '/compte.html'); await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#profile-avatar-trigger').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#change-avatar')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#profile-avatar-menu')).not.toBeVisible();
  await expect(page.locator('#profile-avatar-trigger')).toBeFocused();
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Disney+');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await page.locator('#avatar-dialog').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.width).toBeLessThanOrEqual(390);
  const sample = await page.locator('.avatar-option').first().getAttribute('data-photo-url');
  await page.locator('.avatar-option').first().click();
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText('Disney+');
  await expect(page.locator('.avatar-option[aria-pressed="true"]')).toHaveAttribute('data-photo-url', sample);
  await page.keyboard.press('Escape');
  await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  await expect(page.locator('#profile-avatar-trigger')).toBeFocused();
});

test('nom du profil : sauvegarde Firebase, espaces nettoyés, avatar conservé et persistance', async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.goto(base + '/compte.html#a-voir'); await ready(page);
  const photoURL = await page.evaluate(async () => {
    const selected = window.MovixAvatars.categories[0].groups[0].avatars[0].photoURL;
    await window.MovixAccount.updateAvatar(selected);
    return selected;
  });
  await page.locator('#edit-profile-name').click();
  await expect(page.locator('#profile-name-input')).toBeFocused();
  await page.locator('#profile-name-input').fill('  Ciné Farouk  ');
  await page.locator('#save-profile-name').click();
  await expect(page.locator('#account-page-name')).toHaveText('Ciné Farouk');
  await expect(page.locator('#profile-name-form')).not.toBeVisible();
  await expect(page.locator('#profile-name-status')).toContainText('enregistré');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-user')).photoURL)).toBe(photoURL);
  await page.locator('.account-trigger').click();
  await expect(page.locator('.account-name')).toHaveText('Ciné Farouk');
  await page.reload(); await ready(page);
  await expect(page.locator('#account-page-name')).toHaveText('Ciné Farouk');
  await page.goto(base + '/netflix.html'); await ready(page);
  await page.locator('.account-trigger').click();
  await expect(page.locator('.account-name')).toHaveText('Ciné Farouk');
});

test('nom du profil : validation, annulation, échec réseau et texte sans injection sur mobile', async ({ page }) => {
  await page.goto(base + '/compte.html'); await ready(page);
  await expect(page.locator('#edit-profile-name')).not.toBeVisible();
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.goto(base + '/compte.html'); await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#edit-profile-name').click();
  await page.locator('#profile-name-input').fill('   ');
  await page.locator('#save-profile-name').click();
  await expect(page.locator('#profile-name-status')).toContainText('1 à 60');
  expect(await page.evaluate(async () => { try { await window.MovixAccount.updateDisplayName('x'.repeat(61)); return false; } catch { return true; } })).toBe(true);
  await page.locator('#profile-name-input').fill('Modification annulée');
  await page.locator('#cancel-profile-name').click();
  await expect(page.locator('#account-page-name')).toHaveText('Profil');
  await page.locator('#edit-profile-name').click();
  await page.locator('#profile-name-input').fill('Nouveau nom');
  await page.evaluate(() => { window.testNameSaveFails = true; });
  await page.locator('#save-profile-name').click();
  await expect(page.locator('#profile-name-status')).toContainText('Impossible');
  await expect(page.locator('#account-page-name')).toHaveText('Profil');
  await expect(page.locator('#profile-name-input')).toHaveValue('Nouveau nom');
  await expect(page.locator('#save-profile-name')).toBeEnabled();
  await page.evaluate(() => { window.testNameSaveFails = false; });
  await page.locator('#profile-name-input').fill('<img src=x onerror=alert(1)>');
  await page.locator('#save-profile-name').click();
  await expect(page.locator('#account-page-name')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#account-page-name img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#edit-profile-name').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#profile-name-form')).not.toBeVisible();
  await expect(page.locator('#edit-profile-name')).toBeFocused();
});

test('profils : fenêtre depuis le menu, création, modification indépendante et suppression', async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.locator('.account-trigger').click(); await page.locator('.account-dropdown [data-switch-profile]').click();
  await expect(page.locator('#viewer-dialog')).toBeVisible();
  await expect(page.locator('#viewer-title')).toHaveText('Qui regarde ?');
  await expect(page.locator('#viewer-add')).toBeEnabled();
  await expect(page.locator('#viewer-cards [data-profile-id]')).toHaveCount(1);
  await page.locator('#viewer-add').click(); await page.locator('#viewer-name').fill('Mila');
  await page.locator('#viewer-add-form button[type="submit"]').click();
  await expect(page.locator('#viewer-dialog')).not.toBeVisible();
  await page.waitForFunction(() => window.MovixAccount.getUser().displayName === 'Mila');
  expect(await page.evaluate(() => window.MovixAccount.getUser().admin)).toBe(false);
  await page.goto(base + '/compte.html#profil'); await ready(page);
  await expect(page.locator('#account-page-name')).toHaveText('Mila');
  await page.locator('#edit-profile-name').click(); await page.locator('#profile-name-input').fill('Mila cinéma');
  await page.locator('#save-profile-name').click(); await expect(page.locator('#account-page-name')).toHaveText('Mila cinéma');
  await page.locator('#profile-avatar-trigger').click(); await page.locator('#change-avatar').click();
  const avatar = await page.locator('.avatar-option').first().getAttribute('data-photo-url');
  await page.locator('.avatar-option').first().click(); await expect(page.locator('#avatar-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-user')).displayName)).toBe('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-user')).photoURL)).toBe('');
  await page.reload(); await ready(page); await expect(page.locator('#account-page-name')).toHaveText('Mila cinéma');
  expect(await page.evaluate(() => window.MovixAccount.getUser().photoURL)).toBe(avatar);
  await page.locator('.account-sidebar [data-switch-profile]').click(); await page.locator('#viewer-manage').click();
  await page.locator('[data-profile-id="primary"]').click(); await page.waitForURL(base + '/compte.html#profil');
  await expect(page.locator('#account-page-name')).toHaveText('Profil');
  await page.locator('.account-sidebar [data-switch-profile]').click();
  await expect(page.locator('#viewer-cards [data-profile-id]')).toHaveCount(2);
  await page.locator('#viewer-manage').click();
  await page.getByRole('button', { name: 'Supprimer le profil Mila cinéma', exact: true }).click();
  await page.locator('#viewer-confirm-delete').click();
  await expect(page.locator('#viewer-cards [data-profile-id]')).toHaveCount(1);
  await expect(page.locator('#viewer-title')).toHaveText('Gérer les profils');
  await expect(page.locator('.viewer-remove')).toHaveCount(0);
});

test('profils : reprise réseau, annulation et fenêtre mobile au clavier', async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.account-trigger').click(); await page.locator('[data-switch-profile]').click();
  await expect(page.locator('#viewer-add')).toBeEnabled(); await page.locator('#viewer-add').click();
  await page.locator('#viewer-name').fill('   '); await page.locator('#viewer-add-form button[type="submit"]').click();
  await expect(page.locator('#viewer-message')).toContainText('1 à 60');
  await page.locator('#viewer-cancel-add').click(); await page.locator('#viewer-add').click();
  await page.locator('#viewer-name').fill('Profil invité');
  await page.route('**/api/profiles', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"PROFILE_STORAGE_UNAVAILABLE"}' }) : route.continue());
  await page.locator('#viewer-add-form button[type="submit"]').click();
  await expect(page.locator('#viewer-message')).toContainText('Impossible');
  await expect(page.locator('#viewer-name')).toHaveValue('Profil invité');
  await expect(page.locator('#viewer-add-form button[type="submit"]')).toBeEnabled();
  await page.unroute('**/api/profiles');
  await page.locator('#viewer-add-form button[type="submit"]').click(); await expect(page.locator('#viewer-dialog')).not.toBeVisible();
  await page.locator('.account-trigger').click(); await page.locator('[data-switch-profile]').click();
  await expect(page.locator('#viewer-cards [data-profile-id]')).toHaveCount(2);
  const box = await page.locator('#viewer-dialog').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#viewer-dialog')).not.toBeVisible();
  await expect(page.locator('.account-trigger')).toBeFocused();
});

test('profils : mêmes profils sur un second appareil, choix actif propre à chaque appareil', async ({ page, browser }) => {
  await login(page); await page.waitForURL(base + '/index.html'); await ready(page);
  await page.locator('.account-trigger').click(); await page.locator('[data-switch-profile]').click();
  await expect(page.locator('#viewer-add')).toBeEnabled(); await page.locator('#viewer-add').click();
  await page.locator('#viewer-name').fill('Famille'); await page.locator('#viewer-add-form button[type="submit"]').click();
  await expect(page.locator('#viewer-dialog')).not.toBeVisible();
  const second = await browser.newContext();
  try {
    await second.route('https://www.gstatic.com/firebasejs/*/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: appStub }));
    await second.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: authStub }));
    const other = await second.newPage();
    await login(other); await other.waitForURL(base + '/index.html'); await ready(other);
    await other.locator('.account-trigger').click(); await other.locator('[data-switch-profile]').click();
    await expect(other.locator('#viewer-cards [data-profile-id]')).toHaveCount(2);
    await expect(other.locator('#viewer-cards')).toContainText('Famille');
    await expect(other.locator('[data-profile-id="primary"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.MovixAccount.getUser().displayName)).toBe('Famille');
  } finally { await second.close(); }
});

test('profil simplifié : historique déclaré, en cours, vrais favoris et persistance',async({page})=>{
 await login(page);await page.waitForURL(base+'/index.html');await ready(page);
 await page.goto(base+'/titre.html?id=movie-tt0816692');await ready(page);await expect(page.locator('.title-follow')).toBeVisible();
 expect(await page.evaluate(()=>window.HessflixActivity.snapshot().history.length)).toBe(0);
 await page.locator('.title-follow').getByRole('button',{name:'À reprendre',exact:true}).click();
 await page.goto(base+'/compte.html#en-cours');await ready(page);await expect(page.locator('#profile-progress-count')).toHaveText('1');await expect(page.locator('#profile-feed')).toContainText('Interstellar');await expect(page.locator('#profile-watched-count')).toHaveText('0');
 await page.locator('#profile-feed a').first().click();await expect(page.locator('#title-name')).toHaveText('Interstellar');await page.locator('.title-follow').getByRole('button',{name:'Marquer comme vu',exact:true}).click();
 await page.goto(base+'/index.html');await ready(page);await page.emulateMedia({reducedMotion:'reduce'});const card=page.locator('#tendances .discovery-card').first();await card.hover();const favoriteTitle=await card.locator('h3').innerText();await card.locator('.favorite-button').click();
 await page.goto(base+'/compte.html#visionnes');await ready(page);await expect(page.locator('#profile-watched-count')).toHaveText('1');await expect(page.locator('#profile-progress-count')).toHaveText('0');await expect(page.locator('#profile-feed')).toContainText('Interstellar');
 await page.locator('.profile-tabs a[href="#favoris"]').click();await expect(page.locator('#profile-favorites-count')).toHaveText('1');await expect(page.locator('#profile-feed')).toContainText(favoriteTitle);
 await page.reload();await ready(page);await expect(page.locator('#profile-favorites-count')).toHaveText('1');await expect(page.locator('#profile-watched-count')).toHaveText('1');
 await page.locator('#profile-feed').getByRole('button',{name:'Retirer des favoris'}).click();await expect(page.locator('#profile-favorites-count')).toHaveText('0');await expect(page.locator('#profile-feed')).toContainText('Pas encore de coup de cœur');
 await page.locator('.profile-tabs a[href="#profil"]').click();const directory=path.join(__dirname,'../../output/profile-dashboard');fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(directory,'mobile.png'),fullPage:true});
 await page.locator('#profile-signout').click();await expect(page.locator('#account-connect')).toBeVisible();await expect(page.locator('#profile-watched-count')).toHaveText('0');
});

test('profil simplifié : épisode vu et historique isolé lors du changement de profil',async({page})=>{
 await login(page);await page.waitForURL(base+'/index.html');await page.goto(base+'/titre.html?id=series-2993');await ready(page);
 await expect(page.locator('#episode-select option')).not.toHaveCount(0);await page.locator('.title-follow').getByRole('button',{name:'Marquer cet épisode comme vu'}).click();
 await page.goto(base+'/compte.html#visionnes');await ready(page);await expect(page.locator('#profile-watched-count')).toHaveText('1');await expect(page.locator('#profile-progress-count')).toHaveText('1');await expect(page.locator('#profile-feed')).toContainText('Saison');
 await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('#viewer-add').click();await page.locator('#viewer-name').fill('Autre spectateur');await page.locator('#viewer-add-form button[type=submit]').click();await expect(page.locator('#viewer-dialog')).toBeHidden();
 await expect(page.locator('#profile-watched-count')).toHaveText('0');await expect(page.locator('#profile-progress-count')).toHaveText('0');
 await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('[data-profile-id="primary"]').click();await expect(page.locator('#viewer-dialog')).toBeHidden();await expect(page.locator('#profile-watched-count')).toHaveText('1');
});

test('profil simplifié : compteur visible, pause en arrière-plan et après inactivité',async({page})=>{
 await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});await login(page);await page.waitForURL(base+'/index.html');await page.goto(base+'/compte.html#temps');await ready(page);
 const before=await page.evaluate(()=>window.HessflixActivity.snapshot().seconds);await page.clock.runFor(20000);
 const visible=await page.evaluate(async()=>{await window.HessflixActivity.flush();return window.HessflixActivity.snapshot().seconds;});expect(visible-before).toBeGreaterThanOrEqual(15);expect(visible-before).toBeLessThanOrEqual(21);
 const hidden=await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));await window.HessflixActivity.flush();return window.HessflixActivity.snapshot().seconds;});await page.clock.runFor(20000);
 expect(await page.evaluate(()=>window.HessflixActivity.snapshot().seconds)).toBe(hidden);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(120000);
 const idle=await page.evaluate(async()=>{await window.HessflixActivity.flush();return window.HessflixActivity.snapshot().seconds;});expect(idle-hidden).toBeGreaterThanOrEqual(85);expect(idle-hidden).toBeLessThanOrEqual(90);
 await page.clock.runFor(20000);expect(await page.evaluate(()=>window.HessflixActivity.snapshot().seconds)).toBe(idle);await expect(page.locator('#profile-feed')).toContainText('pas la durée des vidéos');
});

test('profil simplifié : raccourcis vers les catégories du catalogue',async({page})=>{
 await login(page);await page.waitForURL(base+'/index.html');
 for(const [label,kind]of [['Films','Film'],['Séries','Série'],['Animes','Anime']]){
  await page.goto(base+'/compte.html');await ready(page);await page.locator('.profile-welcome-actions').getByRole('link',{name:label,exact:true}).click();
  await expect(page.locator('[data-filter="'+kind+'"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#resultats')).toBeVisible();
 }
});

async function synced(page){await page.waitForFunction(()=>{const s=window.HessflixPersonal?.snapshot();return s?.syncStatus==='synced'&&s.pending===0;});}
async function secondDevice(browser){const context=await browser.newContext();await context.route('https://www.gstatic.com/firebasejs/*/firebase-app.js',route=>route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:appStub}));await context.route('https://www.gstatic.com/firebasejs/*/firebase-auth.js',route=>route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:authStub}));const page=await context.newPage();await login(page);await page.waitForURL(base+'/index.html');await synced(page);return {context,page};}

test('synchronisation : autre appareil, favoris et à voir, épisodes vus, profil distinct',async({page,browser})=>{
 await login(page);await page.waitForURL(base+'/index.html');await synced(page);
 await page.goto(base+'/titre.html?id=series-2993');await expect(page.locator('#episode-select option')).not.toHaveCount(0);await synced(page);
 await page.locator('#episode-select').selectOption({index:1});await page.locator('.title-follow').getByRole('button',{name:'Marquer cet épisode comme vu'}).click();await page.locator('.title-follow').getByRole('button',{name:'À voir',exact:true}).click();
 await page.evaluate(()=>window.HessflixPersonal.setFavorite('movie-tt0816692',true));await synced(page);
 await expect(page.locator('.title-follow-message')).toContainText('synchronisées');
 const expected=await page.evaluate(()=>{const s=window.HessflixPersonal.snapshot();return {favorites:s.favorites,watchlist:s.watchlist,history:s.history,selections:s.selections};});expect(expected.history[0].choice.episode).toBe(2);
 const other=await secondDevice(browser);try{
  await expect(other.page.locator('#continue-hint')).toContainText('en cours pour ce profil');
  expect(await other.page.evaluate(()=>{const s=window.HessflixPersonal.snapshot();return {favorites:s.favorites,watchlist:s.watchlist,history:s.history,selections:s.selections};})).toEqual(expected);
  await other.page.goto(base+'/titre.html?id=series-2993');await synced(other.page);await expect(other.page.locator('#episode-select')).toHaveValue('2');await expect(other.page.locator('.title-follow').getByRole('button',{name:'✓ Vu',exact:true})).toBeVisible();
  await page.goto(base+'/compte.html#favoris');await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('#viewer-add').click();await page.locator('#viewer-name').fill('Enfant');await page.locator('#viewer-add-form button[type=submit]').click();await expect(page.locator('#viewer-dialog')).toBeHidden();await synced(page);
  expect(await page.evaluate(()=>{const s=window.HessflixPersonal.snapshot();return [s.favorites.length,s.watchlist.length,s.history.length];})).toEqual([0,0,0]);
  await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('[data-profile-id="primary"]').click();await synced(page);await expect(page.locator('#profile-favorites-count')).toHaveText('1');
 }finally{await other.context.close();}
});

test('synchronisation : panne, journal durable après rechargement et reprise sans perte',async({page,browser})=>{
 await login(page);await page.waitForURL(base+'/index.html');await synced(page);await page.route('**/api/personal/**',route=>route.abort());
 await page.evaluate(async()=>{await window.HessflixPersonal.setFavorite('movie-tt0816692',true);await window.HessflixPersonal.setWatchlist('tmdb-tv-66732',true);});
 await expect(page.locator('.personal-sync-notice')).toContainText('conservées');await page.reload();await ready(page);
 await page.waitForFunction(()=>window.HessflixPersonal?.snapshot().syncStatus==='offline');expect(await page.evaluate(()=>window.HessflixPersonal.favorites())).toContain('movie-tt0816692');expect(await page.evaluate(()=>window.HessflixPersonal.snapshot().pending)).toBeGreaterThan(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.unroute('**/api/personal/**');await page.locator('.personal-sync-notice button').click();await synced(page);
 const other=await secondDevice(browser);try{expect(await other.page.evaluate(()=>window.HessflixPersonal.favorites())).toContain('movie-tt0816692');expect(await other.page.evaluate(()=>window.HessflixPersonal.watchlist())).toContain('tmdb-tv-66732');}finally{await other.context.close();}
});

test('synchronisation : migration attribuée uniquement, originaux et données visiteur conservés',async({page})=>{
 await page.goto(base+'/');await ready(page);await page.evaluate(()=>{
  localStorage.setItem('movix-favorites-v1:test-user:primary',JSON.stringify(['movie-tt0816692']));localStorage.setItem('movix-favorites-v1:guest:primary',JSON.stringify(['tmdb-movie-99']));localStorage.setItem('movix-favorites-v1',JSON.stringify(['tmdb-movie-100']));localStorage.setItem('movix-favorites-v1:another-user:primary',JSON.stringify(['tmdb-movie-101']));
  localStorage.setItem('hessflix-activity-v1:test-user:primary',JSON.stringify({version:1,progress:[{id:'series-2993',at:100,status:'in-progress',choice:{season:1,episode:2}}],history:[{id:'series-2993',at:100,choice:{season:1,episode:1}}],seconds:30,days:{'2026-10-24':30},lastEnd:0}));
 });await login(page);await page.waitForURL(base+'/index.html');await synced(page);
 expect(await page.evaluate(()=>window.HessflixPersonal.favorites())).toEqual(['movie-tt0816692']);expect(await page.evaluate(()=>window.HessflixPersonal.snapshot().history.length)).toBe(1);expect(await page.evaluate(()=>localStorage.getItem('movix-favorites-v1:test-user:primary'))).toContain('movie-tt0816692');
 await page.evaluate(()=>window.HessflixPersonal.setFavorite('movie-tt0816692',false));await synced(page);await page.reload();await synced(page);expect(await page.evaluate(()=>window.HessflixPersonal.favorites())).toEqual([]);
});

test('synchronisation : visiteurs locaux sans envoi et anciennes données invalides non écrasées',async({page})=>{
 await page.goto(base+'/');await ready(page);let writes=0;page.on('request',req=>{if(req.url().includes('/api/personal/')&&req.method()==='POST')writes++;});
 await page.evaluate(()=>window.HessflixPersonal.setFavorite('movie-tt0816692',true));await page.reload();await ready(page);expect(await page.evaluate(()=>window.HessflixPersonal.favorites())).toEqual(['movie-tt0816692']);expect(writes).toBe(0);
 await page.evaluate(()=>localStorage.setItem('hessflix-activity-v1:test-user:primary','{broken'));await login(page);await page.waitForURL(base+'/index.html');await synced(page);
 await expect(page.locator('.personal-sync-notice')).toContainText('n’ont pas été importées');expect(await page.evaluate(()=>localStorage.getItem('hessflix-activity-v1:test-user:primary'))).toBe('{broken');expect(await page.evaluate(()=>window.HessflixPersonal.favorites())).toEqual([]);
});

for (const [label, counter] of [['À reprendre', '#profile-progress-count'], ['Marquer comme vu', '#profile-watched-count']]) {
 test('journal durable : navigation immédiate après ' + label, async ({ page }) => {
  await login(page); await page.waitForURL(base + '/index.html');
  await page.goto(base + '/titre.html?id=movie-tt0816692'); await ready(page);
  await page.waitForFunction(() => window.HessflixPersonal?.snapshot().identity === 'test-user:primary' && window.HessflixPersonal.snapshot().profileReady);
  await expect(page.locator('.title-follow').getByRole('button', { name: label, exact: true })).toBeEnabled();
  await page.evaluate(({ label, base }) => {
   const request = navigator.locks.request.bind(navigator.locks);
   navigator.locks.request = (name, ...args) => name.startsWith('hessflix-personal-local:')
    ? new Promise(resolve => setTimeout(() => resolve(request(name, ...args)), 3000)) : request(name, ...args);
   [...document.querySelectorAll('.title-follow button')].find(button => button.textContent === label).click();
   location.assign(base + '/compte.html#profil');
  }, { label, base });
  await page.waitForURL(base + '/compte.html#profil'); await ready(page);
  await expect(page.locator(counter)).toHaveText('1');
  await page.reload(); await ready(page); await expect(page.locator(counter)).toHaveText('1');
 });
}

test('synchronisation : changer de profil avec des modifications en attente ne les réattribue pas',async({page})=>{
 await login(page);await page.waitForURL(base+'/index.html');await page.goto(base+'/compte.html#favoris');await synced(page);
 await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('#viewer-add').click();await page.locator('#viewer-name').fill('Enfant');await page.locator('#viewer-add-form button[type=submit]').click();await expect(page.locator('#viewer-dialog')).toBeHidden();await synced(page);
 const childId=await page.evaluate(()=>window.MovixAccount.getUser().profileId);await page.route('**/api/personal/**',route=>route.abort());await page.evaluate(()=>window.HessflixPersonal.setFavorite('movie-tt0816692',true));
 await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('[data-profile-id="primary"]').click();await expect(page.locator('#profile-favorites-count')).toHaveText('0');
 await page.unroute('**/api/personal/**');await page.evaluate(()=>window.HessflixPersonal.sync());await synced(page);await expect(page.locator('#profile-favorites-count')).toHaveText('0');
 await page.locator('.profile-actions [data-switch-profile]').click();await page.locator('[data-profile-id="'+childId+'"]').click();await synced(page);await expect(page.locator('#profile-favorites-count')).toHaveText('1');
 expect(approvedTestCatalogue.data.get('viewerAccounts/test-user/personal/primary').favorites).toEqual([]);expect(approvedTestCatalogue.data.get('viewerAccounts/test-user/personal/'+childId).favorites).toEqual(['movie-tt0816692']);
});
