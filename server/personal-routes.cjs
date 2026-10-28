const { HttpError } = require('./policy.cjs');
const { createRateLimiter } = require('./rate-limit.cjs');

function createPersonalRoutes({ getAuth, origin, store }) {
  const limit = createRateLimiter();

  async function readBody(request) {
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
      throw new HttpError(415, 'JSON_REQUIRED');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 524288) throw new HttpError(413, 'BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'INVALID_JSON'); }
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !['device', 'operations'].includes(key))) {
      throw new HttpError(400, 'INVALID_PERSONAL_OPERATION');
    }
    return body;
  }

  async function requireOwner(request) {
    const token = /^Bearer (\S{20,8192})$/.exec(request.headers.authorization || '')?.[1];
    if (!token) throw new HttpError(401, 'LOGIN_REQUIRED');
    let identity;
    try { identity = await (await getAuth()).verifyIdToken(token, true); }
    catch { throw new HttpError(401, 'LOGIN_REQUIRED'); }
    if (typeof identity.uid !== 'string' || !identity.uid || identity.uid.length > 128) {
      throw new HttpError(401, 'LOGIN_REQUIRED');
    }
    return identity.uid;
  }

  return {
    async handle(request, response, pathname) {
      function json(status, data) {
        response.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, private', Vary: 'Authorization'
        });
        response.end(JSON.stringify(data));
      }

      try {
        limit(request, 'personal', 180, 1800);
        const match = /^\/api\/personal\/(primary|[a-f0-9-]{36})$/.exec(pathname);
        if (!match) throw new HttpError(404, 'NOT_FOUND');
        if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        if ((request.headers.origin && request.headers.origin !== origin) ||
            (request.method === 'POST' && request.headers.origin !== origin) ||
            request.headers['sec-fetch-site'] === 'cross-site') {
          throw new HttpError(403, 'ORIGIN_REJECTED');
        }
        const uid = await requireOwner(request);
        if (request.method === 'GET') {
          json(200, { state: await store.get(uid, match[1]) });
          return;
        }
        const body = await readBody(request);
        json(200, { state: await store.apply(uid, match[1], body.device, body.operations) });
      } catch (error) {
        const known = error instanceof HttpError;
        json(known ? error.status : 503, {
          error: known ? error.code : 'PERSONAL_UNAVAILABLE',
          ...(known && error.code === 'PERSONAL_OPERATION_REJECTED' ? { rejection: error.rejection } : {})
        });
      }
    }
  };
}

module.exports = { createPersonalRoutes };
