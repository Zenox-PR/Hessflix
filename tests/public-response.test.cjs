const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const { createMovixServer } = require('../server.cjs');
const { createTestFirestore, seedApprovedLegacy } = require('./fixtures/catalogue-db.cjs');
const { acceptedEncoding, acceptsWebP, sendPublicText } = require('../server/public-response.cjs');

async function fixture(work) {
  const db = seedApprovedLegacy(createTestFirestore());
  const server = createMovixServer({ getFirestore: async () => db });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(base + path, { headers, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
  try { await work({ request, base, db }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('réponses publiques : négociation respecte les qualités et les refus explicites', () => {
  assert.equal(acceptedEncoding('br,gzip'), 'br');
  assert.equal(acceptedEncoding('gzip;q=1,br;q=0.5'), 'gzip');
  assert.equal(acceptedEncoding('br;q=0,gzip;q=0'), '');
  assert.equal(acceptedEncoding('gzip;q=bogus'), '');
  assert.equal(acceptsWebP('image/avif,image/webp,image/*;q=0.8'), true);
  assert.equal(acceptsWebP('image/webp;q=0, image/png'), false);
  assert.equal(acceptsWebP('image/webp;q=0.0'), false);
  assert.equal(acceptsWebP('*/*'), false);
});

test('réponses publiques : Brotli/gzip équivalents, HEAD et revalidation sans cache privé', () => fixture(async ({ request }) => {
  const plain = await request('/styles.css', { 'Accept-Encoding': 'identity' });
  assert.equal(plain.status, 200);
  for (const encoding of ['br', 'gzip']) {
    const response = await request('/styles.css', { 'Accept-Encoding': encoding });
    assert.equal(response.headers['content-encoding'], encoding);
    assert.match(response.headers.vary, /Accept-Encoding/);
    assert.ok(response.body.length < plain.body.length);
    assert.deepEqual(encoding === 'br' ? zlib.brotliDecompressSync(response.body) : zlib.gunzipSync(response.body), plain.body);
    const cached = await request('/styles.css', { 'Accept-Encoding': encoding, 'If-None-Match': response.headers.etag });
    assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
  }
  const head = await request('/styles.css', { 'Accept-Encoding': 'br' }, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  const csrf = await request('/api/admin/csrf', { 'Accept-Encoding': 'br' });
  assert.equal(csrf.status, 200); assert.equal(csrf.headers['content-encoding'], undefined); assert.match(csrf.headers['cache-control'], /no-store/);
}));

test('catalogue initial : une seule sérialisation, projection partagée et publications toujours fraîches', () => fixture(async ({ request, db }) => {
  const result = await request('/catalogue-data.js', { 'Accept-Encoding': 'br' });
  assert.equal(result.status, 200); assert.equal(result.headers['content-encoding'], 'br');
  const source = zlib.brotliDecompressSync(result.body).toString('utf8');
  const context = { window: {} }; vm.runInNewContext(source, context);
  assert.strictEqual(context.window.MovixDiscovery.items, context.window.MovixPlatformCatalogue.items);
  assert.ok(context.window.MovixDiscovery.items.length > 100);
  assert.match(result.headers['cache-control'], /no-store/);
  for (const path of [...db.data.keys()]) if (path.startsWith('publicCatalogue/')) db.data.delete(path);
  const fresh = await request('/catalogue-data.js');
  const empty = { window: {} }; vm.runInNewContext(fresh.body.toString('utf8'), empty);
  assert.equal(empty.window.MovixDiscovery.items.length, 0);
}));

test('outils, brouillons, sauvegardes et secrets ne sont jamais servis', () => fixture(async ({ request }) => {
  for (const path of ['/server/hero-store.cjs', '/scripts/optimize-avatars.cjs', '/tests/hero.test.cjs', '/.env', '/.local-backups/optimisation/example.js']) assert.equal((await request(path)).status, 404);
}));

test('compression concurrente : même ressource comptée une seule fois, éviction sans erreur 500', async () => {
  const request = { method: 'GET', headers: { 'accept-encoding': 'br' } };
  const response = () => ({ writeHead(status) { assert.equal(status, 200); }, end(body) { assert.ok(body.length); } });
  const part = randomBytes(256 * 1024), shared = Buffer.concat([part, part, part, part]);
  await Promise.all(Array.from({ length: 32 }, () => sendPublicText(request, response(), shared, { etag: 'shared' })));
  const other = randomBytes(512 * 1024), larger = Buffer.concat([other, other, other, other]);
  await sendPublicText(request, response(), larger, { etag: 'larger' });
});
