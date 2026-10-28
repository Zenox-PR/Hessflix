const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, HttpError } = require('./policy.cjs');
const projectRoot = path.resolve(__dirname, '..');
function within(file, folder) { return file === folder || file.startsWith(folder + path.sep); }
function assertSecureCredentials() {
  // Ne jamais accepter des jetons non signés provenant d'un émulateur dans le serveur réel.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new HttpError(503, 'AUTH_EMULATOR_FORBIDDEN');
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!configured) return; // Identité attachée au serveur / Application Default Credentials.
  const credentialPath = fs.realpathSync(configured);
  let directory = projectRoot;
  let repositoryRoot = projectRoot;
  while (true) {
    if (fs.existsSync(path.join(directory, '.git'))) { repositoryRoot = directory; break; }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (within(credentialPath, projectRoot) || within(credentialPath, repositoryRoot)) throw new HttpError(503, 'CREDENTIALS_INSIDE_PROJECT');
  const metadata = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  if (metadata.project_id && metadata.project_id !== PROJECT_ID) throw new HttpError(503, 'CREDENTIALS_WRONG_PROJECT');
}
const REQUIRED = ['firebaseauth.users.get', 'firebaseauth.users.createSession'];
const FORBIDDEN = ['firebaseauth.users.update', 'firebaseauth.users.create', 'firebaseauth.users.delete', 'resourcemanager.projects.setIamPolicy', 'iam.serviceAccounts.actAs', 'iam.serviceAccounts.getAccessToken'];
function assertRuntimePermissions(permissions) {
  if (REQUIRED.some(permission => !permissions.includes(permission)) || FORBIDDEN.some(permission => permissions.includes(permission))) throw new HttpError(503, 'SERVER_IAM_REJECTED');
}
async function assertProductionIdentity(credential, request = fetch) {
  const expected = process.env.MOVIX_SERVER_SERVICE_ACCOUNT;
  if (!expected || !expected.endsWith(`@${PROJECT_ID}.iam.gserviceaccount.com`)) throw new HttpError(503, 'SERVER_IDENTITY_REQUIRED');
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const metadata = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    if (metadata.type !== 'service_account') throw new HttpError(503, 'SERVER_USER_CREDENTIALS_FORBIDDEN');
  }
  // Méthode vérifiée dans le SDK épinglé 14.5.0 : identité des ADC réellement utilisés,
  // y compris si un fichier ADC utilisateur masque l'identité attachée au serveur.
  if (typeof credential.getServiceAccountEmail !== 'function') throw new HttpError(503, 'SERVER_IDENTITY_UNVERIFIED');
  const email = await credential.getServiceAccountEmail();
  if (email !== expected) throw new HttpError(503, 'SERVER_IDENTITY_MISMATCH');
  const { access_token: token } = await credential.getAccessToken();
  const response = await request(`https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT_ID}:testIamPermissions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: [...REQUIRED, ...FORBIDDEN] }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new HttpError(503, 'SERVER_IAM_UNVERIFIED');
  assertRuntimePermissions((await response.json()).permissions || []);
}
const authInstances = new Map();
async function getFirebaseAuth({ bootstrap = false, production = process.env.NODE_ENV === 'production' || process.env.MOVIX_PUBLIC_ORIGIN?.startsWith('https:') } = {}) {
  const name = bootstrap ? 'movix-bootstrap' : production ? 'movix-server-production' : 'movix-server';
  if (authInstances.has(name)) return authInstances.get(name);
  assertSecureCredentials();
  const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const credential = applicationDefault();
  if (!bootstrap && production) await assertProductionIdentity(credential);
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId: PROJECT_ID, credential }, name);
  const auth = getAuth(app);
  authInstances.set(name, auth);
  return auth;
}
module.exports = { getFirebaseAuth, assertSecureCredentials, assertRuntimePermissions, assertProductionIdentity };
