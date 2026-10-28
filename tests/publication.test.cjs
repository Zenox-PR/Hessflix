const test = require('node:test');
const assert = require('node:assert/strict');
const { forbidden, scan } = require('../scripts/check-publication.cjs');
test('publication: private paths are refused while templates, source and assets remain available', () => {
  for (const file of ['.env', 'nested/.env.production', '.data/viewers.json', '.local-backups/snapshot.json', 'application_default_credentials.json', 'playwright/.auth/state.json', '_source_original/index.ts', 'Movix_Analyse_Code/report.md', 'RAPPORT_P1.md']) assert.equal(forbidden(file), true, file);
  for (const file of ['.env.example', 'server/firebase-admin.cjs', 'firestore.rules', 'assets/hessflix-mark.svg', 'tests/fixtures/catalogue-db.cjs']) assert.equal(forbidden(file), false, file);
});
test('publication: matched secrets are detected without returning their values', () => {
  const secret = 'private-value-' + 'x'.repeat(30);
  const issues = scan('config.txt', Buffer.from('prefix\n' + secret), [secret]);
  assert.equal(issues[0].line, 2);
  assert.equal(issues[0].code, 'KNOWN_PRIVATE_VALUE');
  assert.equal(JSON.stringify(issues).includes(secret), false);
  assert.deepEqual(scan('template.txt', Buffer.from('TMDB_API_KEY=')), []);
});
