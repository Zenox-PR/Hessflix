const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { createMovixServer } = require('../server.cjs');
const { createProfileRepository } = require('../server/viewer-profiles.cjs');
const origin = 'http://localhost:4180';
const token = uid => `signed-test-token-for-${uid}`;
async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-viewers-'));
  const server = createMovixServer({ origin, profilesDirectory: directory, getAuth: () => ({
    async verifyIdToken(value, revoked) {
      assert.equal(revoked, true);
      const uid = ['alice', 'bob'].find(uid => value === token(uid));
      if (!uid) throw new Error('Invalid signature');
      return { uid, admin: false };
    }
  }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(uid, method = 'GET', suffix = '', data, headers = {}) {
    return fetch(base + '/api/profiles' + suffix, { method, headers: { Authorization: `Bearer ${token(uid)}`, Origin: origin, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  }
  try { await run({ request, directory, base }); } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('movix-viewers-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test('profils : jetons vérifiés, origine exacte, données et fichiers privés', () => fixture(async ({ request, base }) => {
  assert.equal((await fetch(base + '/api/profiles')).status, 401);
  assert.equal((await request('fake')).status, 401);
  assert.equal((await request('alice', 'POST', '', { displayName: 'Profil' }, { Origin: 'https://attacker.invalid' })).status, 403);
  for (const data of [{ displayName: 'Profil', admin: true }, { displayName: 'Profil', uid: 'bob' }, { displayName: 'Profil', role: 'admin' }, { displayName: ' ' }, { displayName: 'x'.repeat(61) }, { displayName: 'Profil', photoURL: 'javascript:alert(1)' }]) assert.equal((await request('alice', 'POST', '', data)).status, 400);
  const response = await request('alice'); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await response.json()).profiles, []);
  assert.equal((await fetch(base + '/.data/viewer-profiles/' + createHash('sha256').update('alice').digest('hex') + '.json')).status, 404);
  assert.equal((await request('alice', 'DELETE', '/primary')).status, 404);
}));
test('profils : création, modification, persistance et isolation entre comptes', () => fixture(async ({ request, directory }) => {
  const created = await request('alice', 'POST', '', { displayName: '  Mila  ' }); assert.equal(created.status, 201);
  const [profile] = (await created.json()).profiles; assert.equal(profile.displayName, 'Mila'); assert.equal(profile.photoURL, '');
  assert.deepEqual((await (await request('bob')).json()).profiles, []);
  assert.equal((await request('bob', 'PATCH', '/' + profile.id, { displayName: 'Volé' })).status, 404);
  assert.equal((await request('bob', 'DELETE', '/' + profile.id)).status, 404);
  const updated = await request('alice', 'PATCH', '/' + profile.id, { displayName: 'Mila cinéma', photoURL: 'https://example.com/avatar.png' });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).profiles[0].displayName, 'Mila cinéma');
  assert.equal((await createProfileRepository(directory).read('alice'))[0].photoURL, 'https://example.com/avatar.png');
  assert.equal((await request('alice', 'DELETE', '/' + profile.id)).status, 200);
  assert.deepEqual((await createProfileRepository(directory).read('alice')), []);
}));
test('profils : créations concurrentes sans perte, limite de cinq avec le principal', () => fixture(async ({ request }) => {
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => request('alice', 'POST', '', { displayName: `Profil ${index}` })));
  assert.equal(responses.filter(response => response.status === 201).length, 4);
  assert.equal(responses.filter(response => response.status === 409).length, 4);
  const profiles = (await (await request('alice')).json()).profiles;
  assert.equal(profiles.length, 4); assert.equal(new Set(profiles.map(profile => profile.id)).size, 4);
}));
test('profils : stockage corrompu refusé sans écraser les données', () => fixture(async ({ request, directory }) => {
  const file = path.join(directory, createHash('sha256').update('alice').digest('hex') + '.json');
  await fs.writeFile(file, '{corrupted');
  assert.equal((await request('alice')).status, 503);
  assert.equal((await request('alice', 'POST', '', { displayName: 'Profil' })).status, 503);
  assert.equal(await fs.readFile(file, 'utf8'), '{corrupted');
}));
