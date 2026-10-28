const crypto = require('node:crypto');
const { HttpError, PROJECT_ID, assertLiveAdmin } = require('./policy.cjs');
const { createRateLimiter } = require('./rate-limit.cjs');
const SESSION_MS = 60 * 60 * 1000;
function cookies(request) {
  const result = {};
  for (const item of (request.headers.cookie || '').split(';')) {
    const split = item.indexOf('=');
    if (split !== -1) result[item.slice(0, split).trim()] = item.slice(split + 1).trim();
  }
  return result;
}
function createAdminRoutes({ getAuth, origin }) {
  const secure = new URL(origin).protocol === 'https:';
  const sessionName = secure ? '__Host-movix_admin' : 'movix_admin';
  const csrfName = secure ? '__Host-movix_csrf' : 'movix_csrf';
  const csrfSecret = crypto.randomBytes(32);
  const limit = createRateLimiter();
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  function json(response, status, body, extra = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', ...extra });
    response.end(JSON.stringify(body));
  }
  function sameOrigin(request) {
    if (request.headers.origin !== origin) throw new HttpError(403, 'ORIGIN_REJECTED');
  }
  const sign = value => crypto.createHmac('sha256', csrfSecret).update(value).digest('hex');
  function checkCsrf(request) {
    const supplied = request.headers['x-csrf-token'];
    const stored = cookies(request)[csrfName];
    if (typeof supplied !== 'string' || supplied !== stored) throw new HttpError(403, 'CSRF_REJECTED');
    const [nonce, timestamp, signature] = supplied.split('.');
    const age = Date.now() - Number(timestamp);
    const expected = sign(`${nonce}.${timestamp}`);
    if (!signature || !/^[a-f0-9]{64}$/.test(signature) || !Number.isFinite(age) || age < 0 || age > 300000 || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new HttpError(403, 'CSRF_REJECTED');
  }
  async function body(request, maximumBytes = 8192) {
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, 'JSON_REQUIRED');
    const chunks = [];
    let receivedBytes = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += bytes.length;
      if (receivedBytes > maximumBytes) throw new HttpError(413, 'BODY_TOO_LARGE');
      chunks.push(bytes);
    }
    // A UTF-8 character may span several network chunks. Decode only once, after
    // enforcing the limit on the received bytes, not on a partially decoded string.
    try {
      const data = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, receivedBytes));
      return JSON.parse(data);
    } catch {
      throw new HttpError(400, 'INVALID_JSON');
    }
  }
  async function requireSession(request) {
    limit(request, 'verify', 60, 300);
    const value = cookies(request)[sessionName];
    if (!value) throw new HttpError(401, 'LOGIN_REQUIRED');
    const auth = await getAuth();
    let identity;
    try { identity = await auth.verifySessionCookie(value, true); }
    catch (error) {
      if (error.code && !/^auth\/(session-cookie-revoked|session-cookie-expired|invalid-session-cookie|argument-error|user-disabled|user-not-found|id-token-revoked)$/.test(error.code)) throw error;
      throw new HttpError(401, 'INVALID_SESSION');
    }
    return assertLiveAdmin(auth, identity);
  }
  async function handle(request, response, pathname) {
    // Compter aussi les requêtes invalides, avant le SDK et la lecture du corps.
    limit(request, 'api', 120, 600);
    if (pathname === '/api/admin/csrf' && request.method === 'GET') {
      if (request.headers.origin && request.headers.origin !== origin) throw new HttpError(403, 'ORIGIN_REJECTED');
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'ORIGIN_REJECTED');
      const nonce = `${crypto.randomBytes(24).toString('hex')}.${Date.now()}`;
      const value = `${nonce}.${sign(nonce)}`;
      json(response, 200, { csrfToken: value }, { 'Set-Cookie': cookie(csrfName, value, 300) });
    } else if (pathname === '/api/admin/session' && request.method === 'POST') {
      limit(request, 'login', 10, 100);
      sameOrigin(request);
      checkCsrf(request);
      const payload = await body(request);
      if (typeof payload?.idToken !== 'string' || payload.idToken.length < 20) throw new HttpError(400, 'TOKEN_REQUIRED');
      const auth = await getAuth();
      const identity = await auth.verifyIdToken(payload.idToken, true);
      await assertLiveAdmin(auth, identity);
      const age = Date.now() / 1000 - identity.auth_time;
      if (!Number.isFinite(age) || age < -60 || age > 300) throw new HttpError(401, 'RECENT_LOGIN_REQUIRED');
      const session = await auth.createSessionCookie(payload.idToken, { expiresIn: SESSION_MS });
      json(response, 200, { ok: true }, { 'Set-Cookie': cookie(sessionName, session, SESSION_MS / 1000) });
    } else if (pathname === '/api/admin/session' && request.method === 'DELETE') {
      sameOrigin(request);
      checkCsrf(request);
      json(response, 200, { ok: true }, { 'Set-Cookie': cookie(sessionName, '', 0) });
    } else if (pathname === '/api/admin/status' && request.method === 'GET') {
      const identity = await requireSession(request);
      json(response, 200, { uid: identity.uid, role: 'admin', projectId: PROJECT_ID, verifiedByServer: true });
    } else {
      json(response, 404, { error: 'NOT_FOUND' });
    }
  }
  function error(response, error) {
    const setupError = error.code === 'MODULE_NOT_FOUND' || /credential|ENOTFOUND|EAI_AGAIN/i.test(error.code || '');
    const status = error.status || (setupError ? 503 : 401);
    json(response, status, { error: error instanceof HttpError ? error.code : setupError ? 'ADMIN_SERVER_NOT_CONFIGURED' : 'INVALID_SESSION' }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
  }
  return { handle, requireSession, sameOrigin, checkCsrf, body, json, error, clearSession: () => cookie(sessionName, '', 0) };
}
module.exports = { createAdminRoutes };
