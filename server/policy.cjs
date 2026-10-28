const PROJECT_ID = 'demo-hessflix';
const ADMIN_UID = 'example-admin-uid';
class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function isAdmin(identity) {
  return Boolean(identity && identity.uid === ADMIN_UID && identity.admin === true);
}
async function assertLiveAdmin(auth, identity) {
  if (!isAdmin(identity)) throw new HttpError(403, 'ADMIN_REQUIRED');
  const account = await auth.getUser(identity.uid);
  if (account.disabled || account.customClaims?.admin !== true) throw new HttpError(403, 'ADMIN_REQUIRED');
  return identity;
}
module.exports = { PROJECT_ID, ADMIN_UID, HttpError, isAdmin, assertLiveAdmin };
