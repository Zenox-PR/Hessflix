const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { HttpError } = require('./policy.cjs');
const { createRateLimiter } = require('./rate-limit.cjs');
const { validPhotoURL } = require('../catalogue-model.js');
const MAX_PROFILES = 5; // Le profil principal Firebase est toujours présent.
const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
function validate(data, partial = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['displayName', 'photoURL'].includes(key))) throw new HttpError(400, 'INVALID_PROFILE');
  if (!partial || 'displayName' in data) {
    if (typeof data.displayName !== 'string' || !data.displayName.trim() || data.displayName.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(data.displayName)) throw new HttpError(400, 'INVALID_PROFILE');
  }
  if ('photoURL' in data && !validPhotoURL(data.photoURL)) throw new HttpError(400, 'INVALID_PROFILE');
  if (partial && !Object.keys(data).length) throw new HttpError(400, 'INVALID_PROFILE');
  return { ...('displayName' in data ? { displayName: data.displayName.trim() } : {}), ...('photoURL' in data ? { photoURL: data.photoURL } : {}) };
}
function createProfileRepository(directory) {
  const root = path.resolve(directory);
  const pending = new Map();
  const filename = uid => {
    if (typeof uid !== 'string' || !uid || uid.length > 128) throw new HttpError(401, 'LOGIN_REQUIRED');
    return path.join(root, createHash('sha256').update(uid).digest('hex') + '.json');
  };
  async function read(uid) {
    try {
      const file = filename(uid);
      if ((await fs.stat(file)).size > 32768) throw new Error('Invalid size');
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.version !== 1 || !Array.isArray(record.profiles) || record.profiles.length >= MAX_PROFILES) throw new Error('Invalid record');
      const ids = new Set();
      for (const profile of record.profiles) {
        if (!profile || !validId(profile.id) || ids.has(profile.id)) throw new Error('Invalid identifier');
        ids.add(profile.id);
        if (Object.keys(profile).some(key => !['id', 'displayName', 'photoURL'].includes(key))) throw new Error('Invalid field');
        validate({ displayName: profile.displayName, photoURL: profile.photoURL });
      }
      return record.profiles;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new HttpError(503, 'PROFILE_STORAGE_UNAVAILABLE');
    }
  }
  async function mutate(uid, action) {
    const previous = pending.get(uid) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const profiles = await read(uid);
      action(profiles);
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const file = filename(uid);
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, profiles }), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return profiles;
    });
    pending.set(uid, task);
    try { return await task; } finally { if (pending.get(uid) === task) pending.delete(uid); }
  }
  return {
    read,
    create(uid, data) {
      const profile = { id: randomUUID(), photoURL: '', ...validate(data) };
      return mutate(uid, profiles => {
        if (profiles.length >= MAX_PROFILES - 1) throw new HttpError(409, 'PROFILE_LIMIT');
        profiles.push(profile);
      });
    },
    update(uid, id, data) {
      if (!validId(id)) throw new HttpError(400, 'INVALID_PROFILE_ID');
      const changes = validate(data, true);
      return mutate(uid, profiles => {
        const profile = profiles.find(item => item.id === id);
        if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND');
        Object.assign(profile, changes);
      });
    },
    remove(uid, id) {
      if (!validId(id)) throw new HttpError(400, 'INVALID_PROFILE_ID');
      return mutate(uid, profiles => {
        const index = profiles.findIndex(item => item.id === id);
        if (index === -1) throw new HttpError(404, 'PROFILE_NOT_FOUND');
        profiles.splice(index, 1);
      });
    }
  };
}
function createProfileRoutes({ getAuth, origin, directory, repository = createProfileRepository(directory) }) {
  const limit = createRateLimiter();
  function json(response, code, result) {
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Vary': 'Authorization' });
    response.end(JSON.stringify(result));
  }
  async function body(request) {
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, 'JSON_REQUIRED');
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) throw new HttpError(413, 'BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'INVALID_JSON'); }
  }
  return {
    async handle(request, response, pathname) {
      try {
        limit(request, 'profiles', 120, 600);
        const match = /^\/api\/profiles(?:\/([a-f0-9-]{36}))?$/.exec(pathname);
        if (!match) throw new HttpError(404, 'NOT_FOUND');
        if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        if ((request.headers.origin && request.headers.origin !== origin) || (request.method !== 'GET' && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'ORIGIN_REJECTED');
        const token = /^Bearer (\S{20,8192})$/.exec(request.headers.authorization || '')?.[1];
        if (!token) throw new HttpError(401, 'LOGIN_REQUIRED');
        let identity;
        try { identity = await (await getAuth()).verifyIdToken(token, true); } catch { throw new HttpError(401, 'LOGIN_REQUIRED'); }
        const uid = identity.uid;
        if (typeof uid !== 'string' || !uid || uid.length > 128) throw new HttpError(401, 'LOGIN_REQUIRED');
        let profiles;
        if (request.method === 'GET' && !match[1]) profiles = await repository.read(uid);
        else if (request.method === 'POST' && !match[1]) profiles = await repository.create(uid, await body(request));
        else if (request.method === 'PATCH' && match[1]) profiles = await repository.update(uid, match[1], await body(request));
        else if (request.method === 'DELETE' && match[1]) profiles = await repository.remove(uid, match[1]);
        else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        json(response, request.method === 'POST' ? 201 : 200, { profiles, maximum: MAX_PROFILES });
      } catch (error) {
        if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
        json(response, error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.code : 'PROFILE_STORAGE_UNAVAILABLE' });
      }
    }
  };
}
module.exports = { createProfileRepository, createProfileRoutes, MAX_PROFILES, validate, validId };
