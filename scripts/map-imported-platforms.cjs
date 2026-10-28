// Explicit local maintenance command; never registered as a public HTTP route.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getFirebaseAuth } = require('../server/firebase-admin.cjs');
const { getCatalogueFirestore } = require('../server/catalogue-firestore.cjs');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { createTMDBClient } = require('../server/tmdb-client.cjs');
const { ADMIN_UID, PROJECT_ID } = require('../server/policy.cjs');
const { mapping } = require('../server/platform-mapping.cjs');
const { canonical } = require('../server/catalogue-model.cjs');
const root = path.resolve(__dirname, '..');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });

async function main() {
  const [job, mode] = process.argv.slice(2);
  if (process.argv.length !== 4 || !/^popular-\d{8}-[a-f0-9]{12}$/.test(job || '') || !['--check', '--apply'].includes(mode)) {
    throw { code: 'USE_IMPORT_JOB_AND_CHECK_OR_APPLY' };
  }
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const plan = JSON.parse(fs.readFileSync(path.join(root, '.local-backups', job, 'plan.json'), 'utf8'));
  if (plan.jobId !== job || plan.items.length !== 50) throw { code: 'PLATFORMS_IMPORT_PLAN_INVALID' };
  const ids = plan.items.map(row => canonical(row.item.mediaType, row.item.tmdbId));
  if (new Set(ids).size !== 50) throw { code: 'PLATFORMS_DUPLICATE_ID' };
  const owner = await (await getFirebaseAuth()).getUser(ADMIN_UID);
  if (owner.disabled || owner.customClaims?.admin !== true) throw { code: 'PLATFORMS_OWNER_NOT_AUTHORIZED' };
  const db = await getCatalogueFirestore();
  try {
    // Read only entry/public documents, never the thousands of episode documents.
    const before = await db.collection('catalogueEntries').get();
    const publicBefore = await db.collection('publicCatalogue').get();
    const byId = new Map(before.docs.map(doc => [doc.id, doc.data()]));
    const client = createTMDBClient();
    const rows = [];
    for (const id of ids) {
      const entry = byId.get(id);
      if (!entry || entry.importJobId !== job || entry.status !== 'published') throw { code: 'PLATFORMS_SCOPE_CHANGED' };
      const prefix = `/${entry.mediaType}/${entry.tmdbId}`;
      const [offers, details] = await Promise.all([client.get(prefix + '/watch/providers'), client.get(prefix)]);
      if (offers.stale || details.stale || details.data.id !== entry.tmdbId) throw { code: 'PLATFORMS_UNVERIFIED_DATA' };
      const result = mapping(offers.data, details.data, entry.editor.platforms || []);
      rows.push({ id, title: entry.editor.title || entry.meta.title, version: entry.version, ...result,
        evidence: { country: 'FR', type: 'flatrate', checkedAt: new Date().toISOString(),
          endpoint: `https://api.themoviedb.org/3${prefix}/watch/providers`,
          productionCompanies: (details.data.production_companies || []).map(company => ({ id: company.id, name: company.name })) } });
    }
    const folder = path.join(root, '.local-backups', 'platforms-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
    fs.mkdirSync(folder, { recursive: true });
    write(path.join(folder, 'before.json'), { projectId: PROJECT_ID,
      entries: before.docs.map(doc => ({ id: doc.id, data: doc.data() })),
      public: publicBefore.docs.map(doc => ({ id: doc.id, data: doc.data() })) });
    write(path.join(folder, 'mapping.json'), { jobId: job, mode, rows });
    const changed = [];
    const store = createCatalogueStore({ getFirestore: async () => db });
    for (const row of rows.filter(row => row.added.length)) {
      if (mode === '--apply') {
        // Existing optimistic concurrency prevents overwriting concurrent admin edits.
        await store.patch(row.id, row.version, ADMIN_UID, { editor: { platforms: row.platforms } });
        write(path.join(folder, row.id + '.receipt.json'), { id: row.id, platforms: row.platforms });
      }
      changed.push({ id: row.id, title: row.title, platforms: row.platforms });
    }
    if (mode === '--apply') {
      const after = await db.collection('catalogueEntries').get();
      const afterPublic = await db.collection('publicCatalogue').get();
      const changedIds = new Set(changed.map(row => row.id));
      for (const doc of after.docs) {
        const previous = byId.get(doc.id), current = doc.data();
        if (!previous) throw { code: 'PLATFORMS_CONCURRENT_CATALOGUE_CHANGE' };
        if (changedIds.has(doc.id)) {
          const expected = rows.find(row => row.id === doc.id);
          if (JSON.stringify(current.editor.platforms) !== JSON.stringify(expected.platforms)) throw { code: 'PLATFORMS_VERIFY_FAILED' };
          const restored = { ...current, editor: { ...current.editor, platforms: previous.editor.platforms }, version: previous.version, updatedAt: previous.updatedAt, updatedBy: previous.updatedBy };
          if (JSON.stringify(restored) !== JSON.stringify(previous)) throw { code: 'PLATFORMS_UNEXPECTED_CHANGE' };
        } else if (JSON.stringify(current) !== JSON.stringify(previous)) throw { code: 'PLATFORMS_CONCURRENT_CATALOGUE_CHANGE' };
      }
      for (const row of rows) {
        const projected = afterPublic.docs.find(doc => doc.id === row.id)?.data();
        if (JSON.stringify(projected?.platforms) !== JSON.stringify(row.platforms)) throw { code: 'PLATFORMS_PUBLIC_VERIFY_FAILED' };
      }
      write(path.join(folder, 'verified.json'), { changed: changed.length, verified: rows.length, at: new Date().toISOString() });
    }
    console.log(JSON.stringify({ mode, backup: folder, inspected: rows.length, changed,
      counts: Object.fromEntries(['netflix', 'prime-video', 'paramount', 'disney', 'marvel'].map(platform => [platform, rows.filter(row => row.platforms.includes(platform)).length])),
      withoutPlatform: rows.filter(row => !row.platforms.length).map(row => ({ id: row.id, title: row.title })) }));
  } finally { await db.terminate(); }
}

if (require.main === module) main().catch(error => {
  const code = typeof error.code === 'string' && /^[A-Z_0-9]{1,80}$/.test(error.code) ? error.code : 'PLATFORMS_UNAVAILABLE';
  console.error(JSON.stringify({ code, message: 'Traitement arrêté. Les sauvegardes et reçus restent disponibles ; aucun secret affiché.' }));
  process.exitCode = 1;
});
