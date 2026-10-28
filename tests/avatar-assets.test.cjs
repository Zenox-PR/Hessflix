const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { createMovixServer } = require('../server.cjs');
const root = path.resolve(__dirname, '..');

function files(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename, extension) : filename.endsWith(extension) ? [filename] : [];
  });
}
function webpSize(bytes) {
  const type = bytes.toString('ascii', 12, 16);
  if (type === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (type === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (type === 'VP8L') { const packed = bytes.readUInt32LE(21); return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }; }
  throw new Error('En-tête WebP absent');
}

test('avatars : variantes complètes bornées à192px, PNG et chemins historiques conservés', () => {
  const originalRoot = path.join(root, 'assets', 'avatars');
  const variantRoot = path.join(root, 'assets', 'avatar-thumbnails');
  const originals = files(originalRoot, '.png');
  assert.equal(originals.length, 1559);
  let originalBytes = 0, variantBytes = 0;
  for (const original of originals) {
    const variant = path.join(variantRoot, path.relative(originalRoot, original).replace(/\.png$/, '.webp'));
    const png = fs.readFileSync(original), webp = fs.readFileSync(variant);
    // Quelques fichiers source portent déjà .png alors que leurs octets sont JPEG.
    // Ne pas les renommer : ces chemins peuvent être enregistrés dans les profils existants.
    const supportedSource = png.toString('ascii', 1, 4) === 'PNG' || (png[0] === 0xff && png[1] === 0xd8) || png.toString('ascii', 8, 12) === 'WEBP';
    assert.ok(supportedSource, original);
    assert.equal(webp.toString('ascii', 0, 4), 'RIFF', variant);
    assert.equal(webp.toString('ascii', 8, 12), 'WEBP', variant);
    const size = webpSize(webp); assert.ok(size.width > 0 && size.width <= 192 && size.height > 0 && size.height <= 192, variant);
    originalBytes += png.length; variantBytes += webp.length;
  }
  assert.ok(variantBytes < originalBytes * .15);
});

test('avatars HTTP : négociation WebP, q=0 et ancien client PNG ; source privée jamais nécessaire', async () => {
  const server = createMovixServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const route = '/assets/avatars/crunchyroll/aot/annie-avatar.png';
  try {
    const modern = await fetch(base + route, { headers: { Accept: 'image/avif,image/webp,image/png;q=0.8' } });
    assert.equal(modern.status, 200); assert.equal(modern.headers.get('content-type'), 'image/webp'); assert.match(modern.headers.get('vary'), /Accept/);
    assert.equal(Buffer.from(await modern.arrayBuffer()).toString('ascii', 8, 12), 'WEBP');
    for (const accept of ['image/png', 'image/webp;q=0,image/png', 'image/webp; q=0.0, image/png']) {
      const old = await fetch(base + route, { headers: { Accept: accept } }); assert.equal(old.status, 200); assert.equal(old.headers.get('content-type'), 'image/png', accept);
      assert.equal(Buffer.from(await old.arrayBuffer()).toString('ascii', 1, 4), 'PNG');
    }
    const jpeg = await fetch(base + '/assets/avatars/crunchyroll/bocchi_the_rock_!/avatar.png', { headers: { Accept: 'image/png' } });
    assert.equal(jpeg.headers.get('content-type'), 'image/jpeg');
    const jpegBytes = Buffer.from(await jpeg.arrayBuffer()); assert.equal(jpegBytes[0], 0xff); assert.equal(jpegBytes[1], 0xd8);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
