const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createMovixServer } = require('../server.cjs');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { videoSource } = require('../server/vidmoly.cjs');
const { ADMIN_UID } = require('../server/policy.cjs');
const { media } = require('../server/tmdb-model.cjs');
const { movie, tv } = require('./fixtures/tmdb.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const URL1 = 'https://vidmoly.org/embed-aaaaaaaaaaaa.html';
const URL2 = 'https://vidmoly.org/embed-bbbbbbbbbbbb.html';
const origin = 'http://localhost:4180';

async function fixture(work, identity = { uid: ADMIN_UID, admin: true }) {
  const db = createTestFirestore(), store = createCatalogueStore({ getFirestore: async () => db });
  const auth = {
    verifySessionCookie: async (cookie, revoked) => { assert.equal(revoked, true); if (cookie !== 'video-test') throw Error('Invalid'); return identity; },
    getUser: async () => ({ disabled: false, customClaims: { admin: identity.admin } })
  };
  const server = createMovixServer({ catalogueStore: store, getAuth: () => auth, origin });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (path, cookie = '') => fetch(base + path, { headers: { Cookie: cookie } });
  async function write(path, method, body) {
    const csrf = await get('/api/admin/csrf', 'movix_admin=video-test');
    const token = await csrf.json();
    return fetch(base + path, {
      method, headers: { Origin: origin, Cookie: 'movix_admin=video-test; ' + (csrf.headers.getSetCookie()[0] || '').split(';')[0], 'X-CSRF-Token': token.csrfToken || '', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  const create = type => store.create(media(type === 'movie' ? movie : tv, type), type === 'movie' ? 'Film' : 'Anime', ADMIN_UID);
  async function change(id, action, target = null, url = URL1) {
    const { entry } = await store.get(id);
    return store.changeVideo(id, entry.version, ADMIN_UID, target, action, { url, rightsConfirmed: true });
  }
  async function publish(id) { const { entry } = await store.get(id); return store.patch(id, entry.version, ADMIN_UID, { status: 'published' }); }
  try { await work({ db, store, get, write, base, create, change, publish }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('vidéo : validation stricte, pas de HTML, domaines arbitraires, paramètres ou droits implicites', () => {
  assert.equal(videoSource(URL1, true).embedURL, URL1);
  for (const url of [URL1 + '?api_key=secret', URL1 + '#x', URL1.replace('https:', 'http:'), URL1.replace('vidmoly.org', 'vidmoly.org.evil.test'), URL1.replace('vidmoly.org', 'evil.test@vidmoly.org'), URL1.replace('aaaaaaaaaaaa', '%61aaaaaaaaaaa'), '<iframe src="' + URL1 + '">', 'aaaaaaaaaaaa', 'https://127.0.0.1/test', 'https://vidmoly.org/embed-a.html']) {
    assert.throws(() => videoSource(url, true), error => error.code === 'VIDEO_INVALID_URL');
  }
  assert.throws(() => videoSource(URL1, false), error => error.code === 'VIDEO_RIGHTS_REQUIRED');
});

test('vidéo film : ajout privé, aperçu sans écriture, validation, modification puis retrait', async () => fixture(async ({ create, get, write, store, publish, db }) => {
  let entry = await create('movie'); const path = '/api/admin/catalogue/' + entry.id + '/video';
  let response = await write(path, 'PUT', { version: entry.version, url: URL1, rightsConfirmed: true });
  assert.equal(response.status, 200); entry = (await response.json()).entry;
  assert.equal((await get('/api/catalogue/' + entry.id + '/playback')).status, 404);
  const before = JSON.stringify([...db.data]);
  response = await write('/api/admin/catalogue/video-preview', 'POST', { url: URL1, rightsConfirmed: true });
  assert.equal((await response.json()).embedURL, URL1); assert.equal(JSON.stringify([...db.data]), before);
  entry = (await publish(entry.id)).entry;
  assert.deepEqual(await (await get('/api/catalogue/' + entry.id + '/playback')).json(), { available: false });
  response = await write(path + '/publish', 'POST', { version: entry.version }); assert.equal(response.status, 200); entry = (await response.json()).entry;
  assert.equal((await (await get('/api/catalogue/' + entry.id + '/playback')).json()).embedURL, URL1);
  response = await write(path, 'PUT', { version: entry.version, url: URL2, rightsConfirmed: true }); entry = (await response.json()).entry;
  assert.equal((await (await get('/api/catalogue/' + entry.id + '/playback')).json()).embedURL, URL1);
  assert.ok(!(await (await get('/catalogue-data.js')).text()).includes('vidmoly.org'));
  assert.ok(!JSON.stringify(await store.publicGet(entry.id)).includes('vidmoly.org'));
  response = await write(path + '/publish', 'POST', { version: entry.version }); entry = (await response.json()).entry;
  assert.equal((await (await get('/api/catalogue/' + entry.id + '/playback')).json()).embedURL, URL2);
  response = await write(path, 'DELETE', { version: entry.version }); assert.equal(response.status, 200);
  assert.deepEqual(await (await get('/api/catalogue/' + entry.id + '/playback')).json(), { available: false });
}));

test('vidéo épisodes : séparation des saisons/épisodes et trois publications obligatoires', async () => fixture(async ({ create, store, change, publish, get }) => {
  const entry = await create('tv'); const id = entry.id;
  const guide = { episodes: [1, 2].map(number => ({ number, season: 1, tmdbId: 100 + number, title: 'Épisode ' + number })) };
  for (const number of [1, 2]) { const current = await store.get(id); await store.importSeason(id, current.entry.version, ADMIN_UID, number, guide); }
  await change(id, 'save', { season: 1, episode: 1 }); await change(id, 'publish', { season: 1, episode: 1 });
  await change(id, 'save', { season: 1, episode: 2 }, URL2); await change(id, 'publish', { season: 1, episode: 2 });
  await publish(id);
  const url = '/api/catalogue/' + id + '/playback?season=1&episode=';
  assert.equal((await get(url + '1')).status, 404);
  let current = await store.get(id); await store.patchSeason(id, current.entry.version, ADMIN_UID, 1, { published: true });
  assert.equal((await get(url + '1')).status, 404);
  for (const episode of [1, 2]) { current = await store.get(id); await store.patchEpisode(id, current.entry.version, ADMIN_UID, 1, episode, { published: true }); }
  assert.equal((await (await get(url + '1')).json()).embedURL, URL1);
  assert.equal((await (await get(url + '2')).json()).embedURL, URL2);
  assert.equal((await get('/api/catalogue/' + id + '/playback?season=2&episode=1')).status, 404);
  await change(id, 'save', { season: 1, episode: 1 }, URL2); await change(id, 'publish', { season: 1, episode: 1 });
  assert.equal((await (await get(url + '1')).json()).embedURL, URL2);
  await change(id, 'remove', { season: 1, episode: 1 });
  assert.deepEqual(await (await get(url + '1')).json(), { available: false });
  current = await store.get(id); await store.patchEpisode(id, current.entry.version, ADMIN_UID, 1, 2, { published: false });
  assert.equal((await get(url + '2')).status, 404);
}));

test('vidéo : actualisation TMDB préserve les associations sans transférer une identité', async () => fixture(async ({ create, store, change }) => {
  const movieEntry = await create('movie'); await change(movieEntry.id, 'save'); await change(movieEntry.id, 'publish');
  let state = await store.get(movieEntry.id); await store.refresh(movieEntry.id, state.entry.version, ADMIN_UID, { title: 'Nouveau titre' });
  assert.equal((await store.get(movieEntry.id)).entry.video.approved.embedURL, URL1);
  const entry = await create('tv'); let current = await store.importSeason(entry.id, entry.version, ADMIN_UID, 1, { episodes: [{ number: 1, tmdbId: 501, title: 'Original' }] });
  await change(entry.id, 'save', { season: 1, episode: 1 });
  current = await store.get(entry.id); await store.importSeason(entry.id, current.entry.version, ADMIN_UID, 1, { episodes: [{ number: 1, tmdbId: 501, title: 'Actualisé' }] });
  assert.equal((await store.season(entry.id, 1)).episodes[0].video.draft.embedURL, URL1);
  current = await store.get(entry.id); await store.importSeason(entry.id, current.entry.version, ADMIN_UID, 1, { episodes: [] });
  await assert.rejects(change(entry.id, 'publish', { season: 1, episode: 1 }), error => error.code === 'CATALOGUE_EPISODE_OBSOLETE');
  current = await store.get(entry.id);
  await assert.rejects(store.importSeason(entry.id, current.entry.version, ADMIN_UID, 1, { episodes: [{ number: 1, tmdbId: 999 }] }), error => error.code === 'CATALOGUE_NUMBERING_CHANGED');
}));

test('vidéo : visiteurs et faux administrateurs refusés sur toutes les écritures', async () => {
  for (const identity of [{ uid: 'regular', admin: false }, { uid: 'other', admin: true }]) {
    await fixture(async ({ write }) => {
      for (const [path, method] of [['/video-preview', 'POST'], ['/tmdb-movie-157336/video', 'PUT'], ['/tmdb-movie-157336/video', 'DELETE'], ['/tmdb-tv-66732/seasons/1/episodes/1/video/publish', 'POST']]) {
        assert.ok([401, 403].includes((await write('/api/admin/catalogue' + path, method, { version: 1, url: URL1, rightsConfirmed: true })).status));
      }
    }, identity);
  }
  await fixture(async ({ base }) => {
    assert.equal((await fetch(base + '/api/admin/catalogue/video-preview', { method: 'POST', body: '{}' })).status, 401);
  });
});

test('vidéo : CSRF, origine, champs interdits, conflits, cible et paramètres contrôlés', async () => fixture(async ({ create, write, get, store, base }) => {
  const entry = await create('movie'), path = '/api/admin/catalogue/' + entry.id + '/video';
  assert.equal((await fetch(base + path, { method: 'PUT', headers: { Cookie: 'movix_admin=video-test', Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await write(path, 'PUT', { version: 1, url: URL1, rightsConfirmed: true, admin: true })).status, 400);
  assert.equal((await write(path, 'PUT', { version: 999, url: URL1, rightsConfirmed: true })).status, 409);
  assert.equal((await write(path, 'PUT', { version: 1, url: URL1, rightsConfirmed: false })).status, 400);
  assert.equal((await write(path + '/publish', 'POST', { version: 1 })).status, 409);
  assert.equal((await write('/api/admin/catalogue/' + entry.id + '/seasons/1/episodes/1/video', 'PUT', { version: 1, url: URL1, rightsConfirmed: true })).status, 400);
  await store.patch(entry.id, 1, ADMIN_UID, { status: 'published' });
  for (const query of ['?season=1', '?season=1&episode=0', '?episode=1&season=-1', '?season=1&episode=1&x=1', '?season=1&season=2&episode=1']) assert.equal((await get('/api/catalogue/' + entry.id + '/playback' + query)).status, 400);
}));

test('vidéo : masquage revérifié même avec projection publique ancienne et source corrompue refusée', async () => fixture(async ({ create, publish, change, db, get }) => {
  const entry = await create('movie'); await change(entry.id, 'save'); await change(entry.id, 'publish'); await publish(entry.id);
  const path = 'catalogueEntries/' + entry.id, old = db.data.get(path);
  db.data.set(path, { ...old, status: 'hidden' });
  assert.equal((await get('/api/catalogue/' + entry.id + '/playback')).status, 404);
  db.data.set(path, { ...old, video: { approved: { embedURL: 'https://evil.invalid/', rightsConfirmed: true } } });
  assert.deepEqual(await (await get('/api/catalogue/' + entry.id + '/playback')).json(), { available: false });
}));

test('vidéo : secrets non exposés, no-store et iframe limitée au seul domaine examiné', async () => fixture(async ({ create, publish, change, get }) => {
  const entry = await create('movie'); await change(entry.id, 'save'); await change(entry.id, 'publish'); await publish(entry.id);
  const previous = process.env.VIDMOLY_API_KEY; process.env.VIDMOLY_API_KEY = 'secret-test-never-send';
  try {
    for (const path of ['/api/catalogue/' + entry.id + '/playback', '/video-player.js', '/admin-video.js', '/titre.html']) {
      const response = await get(path); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(process.env.VIDMOLY_API_KEY));
      const csp = response.headers.get('content-security-policy'); assert.ok(csp.includes('https://vidmoly.org')); assert.ok(!csp.includes('*.vidmoly'));
      if (path.includes('/playback')) assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await get('/.env')).status, 404); assert.equal((await get('/server/vidmoly.cjs')).status, 404);
  } finally { if (previous === undefined) delete process.env.VIDMOLY_API_KEY; else process.env.VIDMOLY_API_KEY = previous; }
}));
