const { HttpError } = require('./policy.cjs');

// Cache borné par processus, indépendant des comptes. Aucun secret dans les clés/valeurs.
function createTMDBClient({ apiKey = () => process.env.TMDB_API_KEY || '', fetchImpl = fetch, now = Date.now, timeoutMs = 8000, maxEntries = 300, maxBytes = 16000000 } = {}) {
  const cache = new Map(), pending = new Map(), queue = [];
  let bytes = 0, active = 0, blockedUntil = 0;
  const configured = () => /^[a-fA-F0-9]{32}$/.test(apiKey());
  async function slot() {
    if (active >= 4) {
      if (queue.length >= 32) throw new HttpError(503, 'TMDB_BUSY');
      await new Promise(resolve => queue.push(resolve));
    } else active++;
  }
  function release() { const next = queue.shift(); if (next) next(); else active--; }
  function store(key, data, ttl) {
    const size = Buffer.byteLength(JSON.stringify(data));
    if (size > maxBytes) return;
    const previous = cache.get(key); if (previous) bytes -= previous.size;
    cache.delete(key);
    while (cache.size >= maxEntries || bytes + size > maxBytes) { const oldest = cache.keys().next().value; bytes -= cache.get(oldest).size; cache.delete(oldest); }
    cache.set(key, { data, size, until: now() + ttl, staleUntil: now() + ttl + 86400000 }); bytes += size;
  }
  async function download(pathname, params) {
    await slot();
    try {
      if (blockedUntil > now()) { const error = new HttpError(429, 'TMDB_RATE_LIMITED'); error.retryAfter = Math.ceil((blockedUntil - now()) / 1000); throw error; }
      const url = new URL('https://api.themoviedb.org/3' + pathname);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      url.searchParams.set('api_key', apiKey());
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429) {
        const seconds = Math.min(300, Math.max(1, Number(response.headers.get('retry-after')) || 30));
        blockedUntil = now() + seconds * 1000;
        await response.body?.cancel();
        const error = new HttpError(429, 'TMDB_RATE_LIMITED'); error.retryAfter = seconds; throw error;
      }
      if (!response.ok) { await response.body?.cancel(); throw new HttpError(response.status === 404 ? 404 : 502, response.status === 404 ? 'TMDB_NOT_FOUND' : 'TMDB_UPSTREAM_FAILED'); }
      if (Number(response.headers.get('content-length')) > 2000000) { await response.body?.cancel(); throw new HttpError(502, 'TMDB_INVALID_RESPONSE'); }
      let length = 0; const chunks = [];
      for await (const chunk of response.body) {
        length += chunk.length; if (length > 2000000) throw new HttpError(502, 'TMDB_INVALID_RESPONSE'); chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(502, 'TMDB_INVALID_RESPONSE');
      return data;
    } catch (error) {
      // Ne jamais propager URL, corps de réponse, clé ou message réseau extérieur.
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'TMDB_UNAVAILABLE');
    } finally { release(); }
  }
  async function get(pathname, params = {}, ttl = 900000) {
    if (!configured()) throw new HttpError(503, 'TMDB_NOT_CONFIGURED');
    if (!/^\/[a-z0-9_/-]+$/.test(pathname)) throw new HttpError(400, 'TMDB_INVALID_PATH');
    const key = pathname + '?' + new URLSearchParams(Object.entries(params).sort()).toString();
    const stored = cache.get(key);
    if (stored?.until > now()) return { data: stored.data, stale: false };
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 40) throw new HttpError(503, 'TMDB_BUSY');
    const promise = download(pathname, params).then(data => { store(key, data, ttl); return { data, stale: false }; }).catch(error => {
      if (stored?.staleUntil > now() && [429, 502, 503].includes(error.status)) return { data: stored.data, stale: true };
      if (stored && cache.get(key) === stored) { cache.delete(key); bytes -= stored.size; }
      throw error;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  }
  function invalidate(pathname) {
    for (const [key,value] of cache) if(key.startsWith(pathname+'?')) { bytes-=value.size;cache.delete(key); }
  }
  return { get, configured, invalidate };
}
module.exports = { createTMDBClient };
