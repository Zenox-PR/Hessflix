// Real application screenshots with an empty in-memory catalogue and fictional identity.
// No cloud SDK, user credentials, third-party posters or production data are used.
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');
const { createMovixServer } = require('../server.cjs');
const { createTestFirestore } = require('../tests/fixtures/catalogue-db.cjs');
const root = path.resolve(__dirname, '..');
const appStub = 'export const getApps=()=>[];export const initializeApp=()=>({});';
const authStub = `
const user={uid:'readme-demo',displayName:'Profil de démonstration',email:'demo@example.test',photoURL:'',providerData:[{providerId:'password'}],getIdTokenResult:async()=>({claims:{admin:false}}),getIdToken:async()=>'readme-demo-token-not-a-real-secret'};
const auth={currentUser:user};
export const getAuth=()=>auth;
export class GoogleAuthProvider{setCustomParameters(){}}
export const onIdTokenChanged=(instance,callback)=>{queueMicrotask(()=>callback(user));return ()=>{};};
export const updateProfile=async(current,data)=>Object.assign(current,data);
export const signInWithPopup=async()=>{};
export const signInWithEmailAndPassword=async()=>{};
export const createUserWithEmailAndPassword=async()=>({user});
export const sendPasswordResetEmail=async()=>{};
export const signOut=async()=>{};
`;

async function main() {
  const profilesDirectory = path.join(root, '.test-runtime', 'readme-profiles');
  fs.mkdirSync(profilesDirectory, { recursive: true });
  const db = createTestFirestore();
  const getAuth = () => ({ verifyIdToken: async (token, revoked) => {
    if (token !== 'readme-demo-token-not-a-real-secret' || revoked !== true) throw Error('INVALID_DEMO_TOKEN');
    return { uid: 'readme-demo' };
  } });
  let server = createMovixServer({ getAuth, getFirestore: async () => db, profilesDirectory });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port, origin = 'http://127.0.0.1:' + port;
  await new Promise(resolve => server.close(resolve));
  server = createMovixServer({ origin, getAuth, getFirestore: async () => db, profilesDirectory });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.MOVIX_TEST_BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce', locale: 'fr-FR' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname.startsWith('/assets/') && !['/assets/avatar-neutral.svg', '/assets/hessflix-mark.svg'].includes(url.pathname)) return route.abort();
        return route.continue();
      }
      const headers = { 'Access-Control-Allow-Origin': '*' };
      if (/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-app\.js$/.test(url.href)) return route.fulfill({ contentType: 'text/javascript', headers, body: appStub });
      if (/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-auth\.js$/.test(url.href)) return route.fulfill({ contentType: 'text/javascript', headers, body: authStub });
      return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.name));
    await page.goto(origin + '/compte.html#profil');
    await page.waitForFunction(() => window.MovixAuthStatus?.state === 'ready' && document.querySelector('#account-content')?.hidden === false);
    await page.getByRole('heading', { name: 'Votre prochaine histoire commence ici.' }).waitFor({ timeout: 5000 }).catch(() => {});
    await page.locator('#profile-feed > *').first().waitFor();
    if (!(await page.locator('body').innerText()).includes('Profil de démonstration')) throw Error('DEMO_PROFILE_NOT_RENDERED');
    const output = path.join(root, 'docs', 'images'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'profile-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw Error('MOBILE_OVERFLOW');
    await page.screenshot({ path: path.join(output, 'profile-mobile.png'), fullPage: true, animations: 'disabled' });
    if (errors.length) throw Error('DEMO_PAGE_ERROR');
    console.log(JSON.stringify({ screenshots: ['docs/images/profile-desktop.png', 'docs/images/profile-mobile.png'], realInterface: true, fictionalData: true, thirdPartyImages: false, cloudAccess: false, pageErrors: 0 }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
if (require.main === module) main().catch(() => { console.error('README_CAPTURE_FAILED'); process.exitCode = 1; });
