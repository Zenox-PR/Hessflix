const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRateLimiter } = require('../server/rate-limit.cjs');
const { createMovixServer } = require('../server.cjs');
const { assertRuntimePermissions, assertProductionIdentity } = require('../server/firebase-admin.cjs');
test('limiteur : expiration, quota global et mémoire bornée', () => {
  let time = 0;
  const limit = createRateLimiter({ now: () => time, windowMs: 1000, maxKeys: 3 });
  const request = ip => ({ socket: { remoteAddress: ip } });
  limit(request('a'), 'login', 1, 2);
  assert.throws(() => limit(request('a'), 'login', 1, 2), { code: 'RATE_LIMITED', retryAfter: 1 });
  limit(request('b'), 'login', 1, 2);
  assert.throws(() => limit(request('c'), 'login', 1, 2), { code: 'RATE_LIMITED' });
  time = 1000;
  limit(request('c'), 'login', 1, 2);
  const bounded = createRateLimiter({ maxKeys: 2 });
  bounded(request('a'), 'read', 100, 100);
  assert.throws(() => bounded(request('b'), 'read', 100, 100), { code: 'RATE_LIMITED' });
});
test('HTTP : tentatives limitées avant Firebase, X-Forwarded-For ignoré, logout disponible', async () => {
  let calls = 0;
  const origin = 'http://localhost:4180';
  const server = createMovixServer({ origin, getAuth: () => { calls++; throw new Error('unexpected'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let n = 0; n < 10; n++) assert.equal((await fetch(base + '/api/admin/session', { method: 'POST', headers: { Origin: origin, 'X-Forwarded-For': `192.0.2.${n}` } })).status, 403);
    const blocked = await fetch(base + '/api/admin/session', { method: 'POST' });
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0); assert.equal(calls, 0);
    const challenge = await fetch(base + '/api/admin/csrf');
    const { csrfToken } = await challenge.json();
    const logout = await fetch(base + '/api/admin/session', { method: 'DELETE', headers: { Origin: origin, Cookie: challenge.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': csrfToken } });
    assert.equal(logout.status, 200);
    for (let n = 0; n < 60; n++) assert.equal((await fetch(base + '/admin')).status, 401);
    assert.equal((await fetch(base + '/admin')).status, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('IAM : permissions minimales acceptées, attribution et IAM étendu refusés', () => {
  const minimal = ['firebaseauth.users.get', 'firebaseauth.users.createSession'];
  assert.doesNotThrow(() => assertRuntimePermissions(minimal));
  for (const permission of ['firebaseauth.users.update', 'firebaseauth.users.create', 'firebaseauth.users.delete', 'resourcemanager.projects.setIamPolicy', 'iam.serviceAccounts.actAs', 'iam.serviceAccounts.getAccessToken']) assert.throws(() => assertRuntimePermissions([...minimal, permission]), { code: 'SERVER_IAM_REJECTED' });
  assert.throws(() => assertRuntimePermissions([]), { code: 'SERVER_IAM_REJECTED' });
});
test('production : identité explicitement déclarée obligatoire avant accès réseau', async () => {
  const previous = process.env.MOVIX_SERVER_SERVICE_ACCOUNT;
  delete process.env.MOVIX_SERVER_SERVICE_ACCOUNT;
  try { await assert.rejects(assertProductionIdentity({}), { code: 'SERVER_IDENTITY_REQUIRED' }); }
  finally { if (previous !== undefined) process.env.MOVIX_SERVER_SERVICE_ACCOUNT = previous; }
});
test('production : identité réelle des ADC et permissions IAM contrôlées, erreurs refusées', async () => {
  const previous = process.env.MOVIX_SERVER_SERVICE_ACCOUNT;
  const previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const email = 'movix-runtime@demo-hessflix.iam.gserviceaccount.com';
  process.env.MOVIX_SERVER_SERVICE_ACCOUNT = email;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = { async getServiceAccountEmail() { return email; }, async getAccessToken() { return { access_token: 'fake-access-token' }; } };
  const request = async (url, options) => {
    assert.match(url, /projects\/demo-hessflix:testIamPermissions$/);
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    assert.ok(JSON.parse(options.body).permissions.includes('firebaseauth.users.update'));
    return { ok: true, json: async () => ({ permissions: ['firebaseauth.users.get', 'firebaseauth.users.createSession'] }) };
  };
  try {
    await assert.doesNotReject(assertProductionIdentity(credential, request));
    await assert.rejects(assertProductionIdentity({ ...credential, getServiceAccountEmail: async () => 'owner@example.com' }, request), { code: 'SERVER_IDENTITY_MISMATCH' });
    await assert.rejects(assertProductionIdentity(credential, async () => ({ ok: false })), { code: 'SERVER_IAM_UNVERIFIED' });
    await assert.rejects(assertProductionIdentity(credential, async () => ({ ok: true, json: async () => ({ permissions: ['firebaseauth.users.get', 'firebaseauth.users.createSession', 'firebaseauth.users.update'] }) })), { code: 'SERVER_IAM_REJECTED' });
  } finally {
    if (previous === undefined) delete process.env.MOVIX_SERVER_SERVICE_ACCOUNT; else process.env.MOVIX_SERVER_SERVICE_ACCOUNT = previous;
    if (previousCredentials !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
  }
});
