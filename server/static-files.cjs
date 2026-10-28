// Les autorisations de chemins sont décidées par server.cjs avant cet appel.
// Ce module s'occupe uniquement des fichiers publics, de leurs formats et du streaming.
const fs = require('node:fs');
const path = require('node:path');
const { sendPublicText, acceptsWebP } = require('./public-response.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.md': 'text/plain; charset=utf-8'
};

function avatarVariant(root, relative, file, request) {
  if (!acceptsWebP(request.headers.accept)) return file;
  const directory = path.join(root, 'assets', 'avatar-thumbnails');
  const name = relative.slice('assets/avatars/'.length).replace(/\.png$/, '.webp');
  try {
    const variant = fs.realpathSync(path.resolve(directory, name));
    if (variant.startsWith(directory + path.sep) && fs.statSync(variant).isFile()) return variant;
  } catch { /* Compatibilité : une variante absente ne rend jamais l'ancien avatar indisponible. */ }
  return file;
}

function avatarMime(file, type) {
  if (!file.endsWith('.png')) return type;
  // Certains fichiers historiques sont des JPEG sous extension PNG.
  const signature = Buffer.alloc(3), descriptor = fs.openSync(file, 'r');
  try { fs.readSync(descriptor, signature, 0, 3, 0); }
  finally { fs.closeSync(descriptor); }
  return signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff ? 'image/jpeg' : type;
}

async function serveStatic(request, response, { root, relative, fail }) {
  let file;
  try { file = fs.realpathSync(path.resolve(root, relative)); }
  catch { return fail(404, 'Fichier introuvable'); }
  if (!file.startsWith(root + path.sep)) return fail(403, 'Accès refusé');
  if (relative.startsWith('assets/') && !file.startsWith(path.join(root, 'assets') + path.sep)) return fail(403, 'Accès refusé');

  const negotiatedAvatar = relative.startsWith('assets/avatars/') && relative.endsWith('.png');
  if (negotiatedAvatar) file = avatarVariant(root, relative, file, request);
  let type = MIME[path.extname(file).toLowerCase()];
  if (negotiatedAvatar) type = avatarMime(file, type);
  const stat = fs.statSync(file);
  if (!type || !stat.isFile()) return fail(404, 'Fichier introuvable');

  if (!request.headers.range && /^(text\/|application\/javascript|image\/svg\+xml)/.test(type)) {
    return sendPublicText(request, response, fs.readFileSync(file), {
      type, cache: 'public, max-age=0, must-revalidate',
      etag: stat.size.toString(16) + '-' + stat.mtimeMs.toString(16)
    });
  }

  const size = stat.size;
  let start = 0, end = size - 1, code = 200;
  const headers = {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin', 'Accept-Ranges': 'bytes',
    ...(negotiatedAvatar ? { Vary: 'Accept' } : {})
  };
  if (request.headers.range) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
    if (!range) return fail(416, 'Plage non disponible');
    start = Number(range[1]); end = range[2] ? Number(range[2]) : size - 1;
    if (start > end || end >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return fail(416, 'Plage non disponible');
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    code = 206;
  }
  headers['Content-Length'] = size ? end - start + 1 : 0;
  response.writeHead(code, headers);
  if (request.method === 'HEAD' || !size) return response.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

module.exports = { serveStatic };
