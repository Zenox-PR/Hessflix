const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const zlib = require('node:zlib');

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const variants = new Map();
const pendingVariants = new Map();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

function acceptedEncoding(header = '') {
  const qualities = new Map(String(header).split(',').map(part => {
    const [name, quality] = part.trim().toLowerCase().split(';');
    const q = quality ? Number(quality.trim().replace(/^q=/, '')) : 1;
    return [name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
  const score = name => qualities.get(name) ?? qualities.get('*') ?? 0;
  if (score('br') > 0 && score('br') >= score('gzip')) return 'br';
  return score('gzip') > 0 ? 'gzip' : '';
}

function acceptsWebP(header = '') {
  return String(header).split(',').some(part => {
    const [name, ...options] = part.trim().toLowerCase().split(';');
    if (name.trim() !== 'image/webp') return false;
    const quality = options.find(value => value.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return Number.isFinite(q) && q > 0 && q <= 1;
  });
}

async function encoded(buffer, encoding, cache) {
  if (!encoding || buffer.length < 512) return { buffer, encoding: '' };
  const key = cache ? createHash('sha256').update(buffer).digest('hex') + ':' + encoding : '';
  if (cache && variants.has(key)) return { buffer: variants.get(key), encoding };
  if (cache && pendingVariants.has(key)) return pendingVariants.get(key);
  const work = (async () => {
    const compressed = encoding === 'br'
      ? await brotli(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : await gzip(buffer, { level: 6 });
    if (compressed.length >= buffer.length) return { buffer, encoding: '' };
    if (cache && compressed.length <= MAX_CACHE_BYTES) {
      // Un autre appel a pu terminer pendant await : ne jamais compter deux fois la même clé.
      if (variants.has(key)) return { buffer: variants.get(key), encoding };
      while (variants.size >= 64 || cacheBytes + compressed.length > MAX_CACHE_BYTES) {
        const first = variants.keys().next().value;
        if (first === undefined) { cacheBytes = 0; break; }
        cacheBytes -= variants.get(first).length;
        variants.delete(first);
      }
      variants.set(key, compressed);
      cacheBytes += compressed.length;
    }
    return { buffer: compressed, encoding };
  })();
  if (cache && pendingVariants.size < 64) pendingVariants.set(key, work);
  try { return await work; }
  finally {
    if (pendingVariants.get(key) === work) pendingVariants.delete(key);
  }
}

// Seulement pour les ressources publiques. Jamais pour les jetons/CSRF ou réponses privées.
async function sendPublicText(request, response, body, {
  type = 'text/javascript; charset=utf-8', cache = 'no-store', etag = '', headers = {}
} = {}) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const chosen = acceptedEncoding(request.headers['accept-encoding']);
  const result = await encoded(source, chosen, Boolean(etag));
  const tag = etag ? `W/"${etag}-${result.encoding || 'identity'}"` : '';
  const outputHeaders = { 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept-Encoding', ...headers };
  if (result.encoding) outputHeaders['Content-Encoding'] = result.encoding;
  if (tag) {
    outputHeaders.ETag = tag;
    if (String(request.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(tag)) {
      response.writeHead(304, outputHeaders);
      response.end();
      return;
    }
  }
  outputHeaders['Content-Length'] = result.buffer.length;
  response.writeHead(200, outputHeaders);
  response.end(request.method === 'HEAD' ? undefined : result.buffer);
}

module.exports = { sendPublicText, acceptedEncoding, acceptsWebP };
