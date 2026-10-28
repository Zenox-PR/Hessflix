// Local explicit import; never served over HTTP. No key/token is printed.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getCatalogueFirestore } = require('../server/catalogue-firestore.cjs');
const { getFirebaseAuth } = require('../server/firebase-admin.cjs');
const { createCatalogueStore } = require('../server/catalogue-store.cjs');
const { createTMDBClient } = require('../server/tmdb-client.cjs');
const { createTMDBRoutes, legacyCatalogue } = require('../server/tmdb-routes.cjs');
const { preparePopular, applyPopular, validatePlan, totals } = require('../server/popular-import.cjs');
const { ADMIN_UID, PROJECT_ID } = require('../server/policy.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const write = (file, value, overwrite = false) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: overwrite ? 'w' : 'wx', mode: 0o600 });
const progress = value => console.log(JSON.stringify(value));

async function snapshot(db) {
  const docs = [];
  const catalogue = await db.collection('catalogueEntries').get();
  for (const entry of catalogue.docs) {
    docs.push({ path: entry.ref.path, data: entry.data() });
    const seasons = await entry.ref.collection('seasons').get();
    for (const season of seasons.docs) {
      docs.push({ path: season.ref.path, data: season.data() });
      const episodes = await season.ref.collection('episodes').get();
      for (const episode of episodes.docs) docs.push({ path: episode.ref.path, data: episode.data() });
    }
  }
  const published = await db.collection('publicCatalogue').get();
  for (const doc of published.docs) docs.push({ path: doc.ref.path, data: doc.data() });
  return { projectId: PROJECT_ID, capturedAt: new Date().toISOString(), docs, catalogue: catalogue.docs.map(doc => ({ ...doc.data(), id: doc.id })) };
}

async function main() {
  if (args.length !== 1 || (!args[0].startsWith('--prepare=') && !args[0].startsWith('--apply='))) throw { code: 'USE_PREPARE_DATE_OR_APPLY_PLAN' };
  if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  const auth = await getFirebaseAuth();
  const owner = await auth.getUser(ADMIN_UID);
  if (owner.disabled || owner.customClaims?.admin !== true) throw { code: 'IMPORT_OWNER_NOT_AUTHORIZED' };
  const db = await getCatalogueFirestore();
  try {
    const store = createCatalogueStore({ getFirestore: async () => db });
    if (args[0].startsWith('--prepare=')) {
      const date = args[0].slice('--prepare='.length);
      const before = await snapshot(db);
      const client = createTMDBClient({ maxEntries: 1500, maxBytes: 48000000 });
      const tmdb = createTMDBRoutes({ root, client });
      const plan = await preparePopular({ client, tmdb, existing: before.catalogue, legacy: legacyCatalogue(root).values(), date, progress });
      validatePlan(plan);
      const folder = path.join(root, '.local-backups', plan.jobId);
      fs.mkdirSync(folder, { recursive: true });
      write(path.join(folder, 'catalogue-before.json'), before);
      write(path.join(folder, 'plan.json'), plan);
      write(path.join(folder, 'receipt.json'), { jobId: plan.jobId, planHash: digest(plan), completed: [] });
      progress({ stage: 'prepared', planFile: path.join(folder, 'plan.json'), ...totals(plan), firestoreWrites: 0 });
    } else {
      const file = fs.realpathSync(path.resolve(args[0].slice('--apply='.length)));
      const allowed = fs.realpathSync(path.join(root, '.local-backups'));
      if (!file.startsWith(allowed + path.sep) || path.basename(file) !== 'plan.json') throw { code: 'IMPORT_UNSAFE_PLAN_PATH' };
      const plan = validatePlan(JSON.parse(fs.readFileSync(file, 'utf8')));
      const folder = path.dirname(file), receiptFile = path.join(folder, 'receipt.json');
      const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      if (receipt.jobId !== plan.jobId || receipt.planHash !== digest(plan) || !Array.isArray(receipt.completed)) throw { code: 'IMPORT_PLAN_CHANGED' };
      if (!fs.existsSync(path.join(folder, 'catalogue-before-apply.json'))) write(path.join(folder, 'catalogue-before-apply.json'), await snapshot(db));
      const result = await applyPopular({ plan, store, uid: ADMIN_UID, completed: receipt.completed, progress,
        checkpoint: completed => { fs.copyFileSync(receiptFile, path.join(folder, 'receipt.previous.json')); write(receiptFile, { ...receipt, completed, updatedAt: new Date().toISOString() }, true); } });
      progress({ stage: 'complete', ...result, completed: result.completed.length });
    }
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch(error => {
  const codes = { 4: 'FIRESTORE_DEADLINE_EXCEEDED', 7: 'FIRESTORE_PERMISSION_DENIED', 8: 'FIRESTORE_QUOTA_EXHAUSTED', 9: 'FIRESTORE_PRECONDITION_FAILED', 14: 'FIRESTORE_UNAVAILABLE', 16: 'FIRESTORE_CREDENTIALS_EXPIRED' };
  const code = typeof error.code === 'string' && /^[A-Z_0-9]{1,80}$/.test(error.code) ? error.code : codes[error.code] || 'IMPORT_UNAVAILABLE';
  console.error(JSON.stringify({ stage: 'stopped', code, message: 'Import interrompu sans suppression. Les fiches déjà publiées sont conservées ; le plan peut être repris. Aucun secret affiché.' })); process.exitCode = 1;
});
