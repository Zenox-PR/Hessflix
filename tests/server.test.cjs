const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createMovixServer } = require('../server.cjs');
const { ADMIN_UID, isAdmin } = require('../server/policy.cjs');
const { grantAdmin, main } = require('../scripts/grant-admin.cjs');
const ORIGIN = 'http://localhost:4180';
function fakeAuth() {
  const identity = { uid: ADMIN_UID, admin: true, auth_time: Math.floor(Date.now() / 1000) };
  return {
    identity,
    account: { uid: ADMIN_UID, disabled: false, customClaims: { admin: true } },
    revoked: false,
    async verifyIdToken(token, checkRevoked) { assert.equal(checkRevoked, true); if (token !== 'valid-owner-token-123456') throw new Error('signature invalid'); return this.identity; },
    async verifySessionCookie(value, checkRevoked) { assert.equal(checkRevoked, true); if (value !== 'verified-session' || this.revoked) throw new Error('invalid session'); return this.identity; },
    async getUser() { return this.account; },
    async createSessionCookie(token, options) { assert.equal(token, 'valid-owner-token-123456'); assert.equal(options.expiresIn, 3600000); return 'verified-session'; }
  };
}
async function withServer(callback, auth = fakeAuth()) {
  const server = createMovixServer({ getAuth: () => auth, origin: ORIGIN });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await callback(base, auth); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function csrf(base) {
  const response = await fetch(base + '/api/admin/csrf');
  assert.equal(response.status, 200);
  return { token: (await response.json()).csrfToken, cookie: response.headers.getSetCookie()[0].split(';')[0] };
}
async function openSession(base, token = 'valid-owner-token-123456', overrides = {}) {
  const challenge = await csrf(base);
  return fetch(base + '/api/admin/session', { method: 'POST', headers: { Origin: ORIGIN, Cookie: challenge.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': challenge.token, ...overrides }, body: JSON.stringify({ idToken: token }) });
}
test('admin exige claim booléen ET UID cible', () => {
  assert.equal(isAdmin({ uid: ADMIN_UID, admin: true }), true);
  for (const identity of [null, {uid: ADMIN_UID}, {uid: ADMIN_UID, admin:'true'}, {uid:'autre', admin:true}]) assert.equal(isAdmin(identity), false);
});
test('grant: UID verrouillé, claims conservés, idempotence, aucun autre argument', async () => {
  const calls = [];
  const account = {uid:ADMIN_UID, customClaims:{existing:'kept'}};
  const auth = { async getUser(uid) { assert.equal(uid,ADMIN_UID); return account; }, async setCustomUserClaims(uid, claims) { calls.push(uid); account.customClaims = claims; } };
  assert.equal(await grantAdmin(auth), 'ready'); assert.equal(calls.length, 0);
  assert.equal(await grantAdmin(auth,true),'granted');
  assert.deepEqual(account.customClaims,{existing:'kept',admin:true});
  assert.deepEqual(calls,[ADMIN_UID]);
  assert.equal(await grantAdmin(auth,true),'already-admin'); assert.equal(calls.length,1);
  await assert.rejects(main(['--uid','autre']));
});
test('visiteur: /admin et API refusés, aucune fuite du document protégé', async () => withServer(async base => {
  const response = await fetch(base+'/admin');
  assert.equal(response.status,401);
  const html = await response.text(); assert.ok(!html.includes('data-admin-protected')); assert.match(html,/Vérifier mon accès/);
  assert.equal((await fetch(base+'/api/admin/status')).status,401);
  for (const route of ['/admin-private/dashboard.html','/server/policy.cjs','/scripts/grant-admin.cjs','/node_modules/firebase-admin/lib/index.js','/.gitignore','/package.json','/firestore.rules','/database.rules.json','/server.cjs','/%2e%2e%2fserver.cjs']) assert.notEqual((await fetch(base+route)).status,200,route);
  assert.equal((await fetch(base+'/index.html')).status,200);
  assert.equal((await fetch(base+'/firebase-auth.js')).status,200);
}));
test('origine forgée, CSRF absent ou falsifié refusés avant Firebase', async () => withServer(async (base,auth) => {
  auth.verifyIdToken=()=>{throw new Error('Ne doit pas être appelé');};
  assert.equal((await openSession(base,undefined,{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await openSession(base,undefined,{'X-CSRF-Token':'forged'})).status,403);
  assert.equal((await fetch(base+'/api/admin/session',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/admin/csrf',{headers:{Origin:'https://attacker.invalid'}})).status,403);
}));
test('jeton falsifié, utilisateur normal et mauvais UID ne deviennent pas admin', async () => withServer(async (base,auth) => {
  assert.equal((await openSession(base,'unsigned-fake-token-12345')).status,401);
  auth.identity={...auth.identity,admin:false}; assert.equal((await openSession(base)).status,403);
  auth.identity={...auth.identity,uid:'autre',admin:true}; assert.equal((await openSession(base)).status,403);
  assert.equal((await fetch(base+'/api/admin/grant',{method:'POST'})).status,404);
}));
test('session admin: cookie HttpOnly, vérification active, révocation et logout', async () => withServer(async (base,auth) => {
  const created = await openSession(base); assert.equal(created.status,200);
  const cookie = created.headers.getSetCookie()[0]; assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/); assert.match(cookie,/Max-Age=3600/);
  const session = cookie.split(';')[0];
  const page = await fetch(base+'/admin',{headers:{Cookie:session}});
  assert.equal(page.status,200); assert.match(await page.text(),/data-admin-protected/); assert.match(page.headers.get('cache-control'),/no-store/);
  const result = await fetch(base+'/api/admin/status',{headers:{Cookie:session}}); assert.equal((await result.json()).uid,ADMIN_UID);
  auth.account.customClaims.admin=false; assert.equal((await fetch(base+'/admin',{headers:{Cookie:session}})).status,403);
  auth.account.customClaims.admin=true; auth.revoked=true; assert.equal((await fetch(base+'/api/admin/status',{headers:{Cookie:session}})).status,401);
  const challenge = await csrf(base);
  const logout = await fetch(base+'/api/admin/session',{method:'DELETE',headers:{Origin:ORIGIN,Cookie:`${challenge.cookie}; ${session}`,'X-CSRF-Token':challenge.token}});
  assert.equal(logout.status,200); assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
}));
test('claim actif obligatoire et connexion récente pour ouvrir la session', async () => withServer(async (base,auth) => {
  auth.account.disabled=true; assert.equal((await openSession(base)).status,403);
  auth.account.disabled=false; auth.account.customClaims={}; assert.equal((await openSession(base)).status,403);
  auth.account.customClaims.admin=true; auth.identity.auth_time-=600;
  const response=await openSession(base); assert.equal(response.status,401); assert.equal((await response.json()).error,'RECENT_LOGIN_REQUIRED');
}));
test('HTTPS en production: préfixe __Host et Secure', async () => {
  const server=createMovixServer({getAuth:()=>fakeAuth(),origin:'https://movix.example'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try { const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/csrf`);const cookie=response.headers.get('set-cookie');assert.match(cookie,/__Host-movix_csrf=/);assert.match(cookie,/; Secure/); } finally {await new Promise(resolve=>server.close(resolve));}
});
test('un serveur mal configuré échoue fermé, jamais en mode administrateur', async () => withServer(async base => {
  const response=await openSession(base);assert.notEqual(response.status,200);
}, {verifyIdToken:async()=>{throw Object.assign(new Error('Unavailable'),{code:'auth/invalid-credential'});}}));
test('SDK Admin réel : rejette un JWT non signé, sans utiliser de clé privée', async () => {
  const {initializeApp,deleteApp}=require('firebase-admin/app');
  const {getAuth}=require('firebase-admin/auth');
  const app=initializeApp({projectId:'demo-hessflix'},'reject-unsigned-test');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=`${encode({alg:'none',typ:'JWT'})}.${encode({sub:ADMIN_UID,admin:true,aud:'demo-hessflix',iss:'https://securetoken.google.com/demo-hessflix',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.fake`;
  try { await assert.rejects(getAuth(app).verifyIdToken(token,true)); } finally {await deleteApp(app);}
});
test('le serveur réel refuse les identités non signées de l’émulateur', () => {
  const {assertSecureCredentials}=require('../server/firebase-admin.cjs');
  const previous=process.env.FIREBASE_AUTH_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
  try {assert.throws(assertSecureCredentials,error=>error.code==='AUTH_EMULATOR_FORBIDDEN');}
  finally {if(previous===undefined)delete process.env.FIREBASE_AUTH_EMULATOR_HOST;else process.env.FIREBASE_AUTH_EMULATOR_HOST=previous;}
});
