// Audit en lecture seule : ni déploiement, ni lecture des données métier.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PROJECT_ID } = require('../server/policy.cjs');
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n').trim()).digest('hex');
async function accessToken() {
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.env.APPDATA || path.join(process.env.HOME || process.cwd(), '.config'), 'gcloud', 'application_default_credentials.json');
  if (fs.existsSync(adc) || process.env.K_SERVICE || process.env.GCE_METADATA_HOST) {
    const { applicationDefault } = require('firebase-admin/app');
    return (await applicationDefault().getAccessToken()).access_token;
  }
  // API interne du CLI épinglé, utilisée uniquement par ce diagnostic local.
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getProjectDefaultAccount(root);
  if (!account) throw Object.assign(new Error('Credentials required'), { code: 'CLOUD_LOGIN_REQUIRED' });
  return (await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'])).access_token;
}
async function main() {
  const report = { project: PROJECT_ID, checkedAt: new Date().toISOString(), readOnly: true, checks: [] };
  let token;
  try { token = await accessToken(); }
  catch (error) { report.checks.push({ check: 'credentials', status: 'UNVERIFIED', code: error.code || 'CREDENTIALS_UNAVAILABLE' }); console.log(JSON.stringify(report, null, 2)); process.exitCode = 2; return; }
  async function get(url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const reason = payload.error?.details?.find(detail => detail.reason)?.reason;
      throw Object.assign(new Error('Cloud check failed'), { code: `HTTP_${response.status}${reason ? ':' + reason : ''}` });
    }
    return response.json();
  }
  async function list(url, field) {
    const items = []; let pageToken;
    do {
      const page = new URL(url); if (pageToken) page.searchParams.set('pageToken', pageToken);
      const data = await get(page); items.push(...(data[field] || [])); pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }
  const checks = [
    ['firestore-databases', `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases`, 'databases'],
    ['storage-buckets', `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`, 'items'],
    ['realtime-instances', `https://firebasedatabase.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/-/instances`, 'instances']
  ];
  for (const [check, url, field] of checks) {
    try {
      const items = await list(url, field);
      report.checks.push({ check, status: 'READ', count: items.length, resources: items.map(item => item.name) });
      if (check === 'realtime-instances') for (const instance of items) {
        if (!instance.databaseUrl) continue;
        const rules = await get(new URL('/.settings/rules.json', instance.databaseUrl));
        const local = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
        report.checks.push({ check: 'realtime-rules', resource: instance.name, status: 'READ', localMatch: JSON.stringify(rules) === JSON.stringify(local) });
      }
    } catch (error) { report.checks.push({ check, status: 'UNVERIFIED', code: error.code || 'NETWORK_ERROR' }); }
  }
  try {
    const releases = await list(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`, 'releases');
    report.checks.push({ check: 'published-rules', status: releases.length ? 'READ' : 'UNVERIFIED', count: releases.length });
    for (const release of releases) {
      const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
      const expected = release.name.includes('/cloud.firestore') ? 'firestore.rules' : release.name.includes('/firebase.storage/') ? 'storage.rules' : null;
      const sources = ruleset.source?.files || [];
      const localMatch = expected ? sources.length === 1 && hash(sources[0].content || '') === hash(fs.readFileSync(path.join(root, expected), 'utf8')) : null;
      report.checks.push({ check: 'rules-release', resource: release.name, ruleset: release.rulesetName, status: 'READ', localMatch });
    }
  } catch (error) { report.checks.push({ check: 'published-rules', status: 'UNVERIFIED', code: error.code || 'NETWORK_ERROR' }); }
  console.log(JSON.stringify(report, null, 2));
  // Lire les règles n'est pas une validation de leur sécurité ; revue humaine nécessaire.
  if (report.checks.some(check => check.status === 'UNVERIFIED' || check.localMatch === false)) process.exitCode = 2;
}
if (require.main === module) main().catch(() => { console.error('CLOUD_CHECK_FAILED (aucun identifiant affiché)'); process.exitCode = 2; });
