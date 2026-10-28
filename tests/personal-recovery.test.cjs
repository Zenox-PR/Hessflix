const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { randomUUID, webcrypto } = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const { createMovixServer } = require('../server.cjs');
const { createTestFirestore } = require('./fixtures/catalogue-db.cjs');
const model = require('../personal-model.js');

const origin = 'http://localhost:4180';
const statePath = 'viewerAccounts/alice/personal/primary';
const storageKey = 'hessflix-personal-v1:alice:primary';
const id = number => `tmdb-movie-${number}`;

function seedFavorites(db, count) {
  const state = model.empty();
  for (let number = 1; number <= count; number++) model.apply(state, { type: 'favorite', id: id(number), value: true });
  db.data.set(statePath, state);
}

async function fixture(work) {
  const db = createTestFirestore();
  const server = createMovixServer({
    origin, getFirestore: async () => db,
    getAuth: () => ({ async verifyIdToken(value, revoked) {
      assert.equal(revoked, true);
      const uid = ['alice', 'bob'].find(uid => value === `recovery-test-token-for-${uid}`);
      if (!uid) throw new Error('Invalid test token');
      return { uid, admin: false };
    } })
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await work({ db, base }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function browser(base, storage = new Map()) {
  let account = { uid: 'alice', profileId: 'primary', profileReady: true };
  let network = 'online';
  let loseNextPostResponse = false;
  let storageWritable = true;
  const listeners = new Set();
  const sent = [];
  const window = new EventTarget();
  window.HessflixPersonalModel = model;
  window.MovixAccount = {
    getUser: () => account,
    getIdToken: async () => `recovery-test-token-for-${account.uid}`,
    subscribe(listener) { listeners.add(listener); listener(account); }
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) { if (!storageWritable) throw new Error('Quota exceeded'); storage.set(key, value); },
    key: index => [...storage.keys()][index] ?? null,
    get length() { return storage.size; }
  };
  const scope = vm.createContext({
    window, document: { body: null, hidden: false, addEventListener() {} }, navigator: {},
    localStorage, structuredClone, crypto: webcrypto, TextEncoder, Event, AbortSignal,
    setTimeout: () => 0, clearTimeout() {}, setInterval() {}, queueMicrotask,
    fetch: async (url, options) => {
      if (network === 'offline') throw new TypeError('Network unavailable');
      if (network === 'post-unavailable' && options.method === 'POST') return Response.json({ error: 'PERSONAL_UNAVAILABLE' }, { status: 503 });
      if (options.body) sent.push(JSON.parse(options.body));
      const response = await fetch(base + url, { ...options, headers: { ...options.headers, Origin: origin } });
      if (options.method === 'POST' && loseNextPostResponse && response.ok) {
        loseNextPostResponse = false;
        throw new TypeError('Response lost after commit');
      }
      return response;
    }
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../personal-sync.js'), 'utf8'), scope);
  window.HessflixPersonal.connect();
  return {
    api: window.HessflixPersonal, storage, sent,
    record: () => JSON.parse(storage.get(`hessflix-personal-v1:${account.uid}:${account.profileId}`)),
    setNetwork: value => { network = value; },
    setWritable: value => { storageWritable = value; },
    loseResponse: () => { loseNextPostResponse = true; },
    select(profileId, uid = 'alice') { account = { uid, profileId, profileReady: true }; for (const listener of listeners) listener(account); }
  };
}

test('recovery: concurrent 500th favorites reject only the losing intent; later valid writes continue in order', () => fixture(async ({ db, base }) => {
  seedFavorites(db, 499);
  const first = browser(base), second = browser(base);
  await first.api.sync(); await second.api.sync();
  await first.api.setFavorite(id(500), true);
  await second.api.setWatchlist('tmdb-tv-66732', true);
  await second.api.setFavorite(id(501), true);
  await second.api.setWatchlist('tmdb-tv-99', true);
  await first.api.sync(); await second.api.sync();
  const current = db.data.get(statePath), record = second.record();
  assert.equal(current.favorites.length, 500);
  assert.ok(current.favorites.includes(id(500))); assert.ok(!current.favorites.includes(id(501)));
  assert.deepEqual(new Set(current.watchlist), new Set(['tmdb-tv-66732', 'tmdb-tv-99']));
  assert.equal(record.pending.length, 0); assert.equal(record.rejected.length, 1);
  assert.equal(record.rejected[0].operation.id, id(501));
  assert.equal(current.cursors[record.device], record.next - 1);
  const recovered = second.sent.find(batch => batch.operations.some(operation => operation.type === 'skip'));
  assert.deepEqual(recovered.operations.map(operation => operation.seq), [2, 3, 4]);
  assert.deepEqual(recovered.operations.map(operation => operation.type), ['watchlist', 'skip', 'watchlist']);
  assert.match(second.api.message(), /autres modifications sont synchronisées/);
}));

test('recovery: after refreshing a full remote list, the pending refused addition cannot block a removal', () => fixture(async ({ db, base }) => {
  seedFavorites(db, 499);
  const first = browser(base), second = browser(base);
  await first.api.sync(); await second.api.sync();
  await first.api.setFavorite(id(500), true); await first.api.sync();
  await second.api.setFavorite(id(501), true);
  second.setNetwork('post-unavailable'); await second.api.sync();
  assert.equal(second.record().base.favorites.length, 500);
  assert.equal(second.record().rejected.length, 0, 'A transient 503 is not a terminal refusal.');
  await second.api.setFavorite(id(1), false);
  assert.ok(!second.api.favorites().includes(id(1)));
  second.setNetwork('online'); await second.api.sync();
  assert.equal(db.data.get(statePath).favorites.length, 499);
  assert.equal(second.record().pending.length, 0);
  assert.equal(second.record().rejected[0].operation.id, id(501));
  await second.api.retryRejected();
  assert.equal(second.record().rejected.length, 0);
  assert.equal(db.data.get(statePath).favorites.length, 500);
  assert.ok(db.data.get(statePath).favorites.includes(id(501)));
}));

test('recovery: lost response after skip commit, reload and duplicate resend preserve the rejection and following changes', () => fixture(async ({ db, base }) => {
  seedFavorites(db, 499);
  const first = browser(base), second = browser(base);
  await first.api.sync(); await second.api.sync();
  await first.api.setFavorite(id(500), true); await first.api.sync();
  await second.api.setFavorite(id(501), true); await second.api.setWatchlist('tmdb-tv-66732', true);
  second.loseResponse(); await second.api.sync();
  const beforeReload = second.record();
  assert.equal(beforeReload.rejected.length, 1); assert.ok(beforeReload.pending.length > 0);
  assert.equal(db.data.get(statePath).cursors[beforeReload.device], beforeReload.next - 1);
  const reloaded = browser(base, second.storage); await reloaded.api.sync();
  assert.equal(reloaded.record().pending.length, 0); assert.equal(reloaded.record().rejected.length, 1);
  assert.deepEqual(db.data.get(statePath).watchlist, ['tmdb-tv-66732']);
  await reloaded.api.setFavorite(id(2), false); await reloaded.api.sync(); await reloaded.api.retryRejected();
  assert.equal(reloaded.record().rejected.length, 0); assert.equal(db.data.get(statePath).favorites.length, 500);
  assert.equal(new Set(db.data.get(statePath).favorites).size, 500);
}));

test('recovery: offline originals and rejection archives stay with their original account/profile', () => fixture(async ({ db, base }) => {
  seedFavorites(db, 499);
  const child = randomUUID(); db.data.set('viewerAccounts/alice', { version: 1, profiles: [{ id: child, displayName: 'Enfant', photoURL: '' }] });
  const first = browser(base), second = browser(base);
  await first.api.sync(); await second.api.sync();
  await second.api.setFavorite(id(501), true);
  second.setNetwork('offline'); await second.api.sync();
  assert.equal(second.record().pending[0].type, 'favorite'); assert.equal(second.record().rejected.length, 0);
  second.select(child); second.setNetwork('online'); await second.api.sync();
  assert.equal(second.api.favorites().length, 0);
  await first.api.setFavorite(id(500), true); await first.api.sync();
  second.select('primary'); await second.api.sync(); assert.equal(second.api.snapshot().rejectedCount, 1);
  second.select('primary', 'bob'); await second.api.sync();
  assert.equal(second.api.favorites().length, 0); assert.equal(second.api.snapshot().rejectedCount, 0);
  second.select('primary'); assert.equal(second.api.snapshot().rejectedCount, 1);
  assert.equal(JSON.parse(second.storage.get(storageKey)).rejected[0].operation.id, id(501));
}));

test('recovery: cursor is not advanced when the refusal archive cannot be persisted', () => fixture(async ({ db, base }) => {
  seedFavorites(db, 499);
  const first = browser(base), second = browser(base);
  await first.api.sync(); await second.api.sync();
  await second.api.setFavorite(id(501), true);
  await first.api.setFavorite(id(500), true); await first.api.sync();
  const initialCursor = db.data.get(statePath).cursors[second.record().device];
  second.setWritable(false); await second.api.sync();
  assert.equal(db.data.get(statePath).cursors[second.record().device], initialCursor);
  assert.equal(second.record().pending[0].type, 'favorite', 'The original durable journal was not replaced.');
  assert.match(second.api.message(), /Stockage indisponible/);
  second.setWritable(true); await second.api.sync();
  assert.equal(second.record().pending.length, 0); assert.equal(second.record().rejected.length, 1);
}));

test('model: a terminal limit rejection is atomic even after an earlier field was modified', () => {
  const state = model.empty();
  for (let number = 1; number <= 500; number++) model.apply(state, { type: 'status', id: id(number), status: 'in-progress', at: number });
  const original = structuredClone(state);
  assert.throws(() => model.apply(state, { type: 'status', id: id(501), status: 'completed', at: 1000 }), error => error.code === 'PERSONAL_PROGRESS_LIMIT');
  assert.deepEqual(state, original, 'No phantom history entry survives the refusal.');
  model.apply(state, { type: 'skip', seq: 7 });
  assert.deepEqual(state, original);
});
