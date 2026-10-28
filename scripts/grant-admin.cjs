// À exécuter uniquement dans un terminal sécurisé. Ce fichier n'est jamais servi par HTTP.
const { getFirebaseAuth } = require('../server/firebase-admin.cjs');
const { PROJECT_ID, ADMIN_UID } = require('../server/policy.cjs');
async function grantAdmin(auth, apply = false) {
  const account = await auth.getUser(ADMIN_UID);
  if (account.uid !== ADMIN_UID || account.disabled) throw new Error('Compte cible indisponible');
  if (account.customClaims?.admin === true) return 'already-admin';
  if (!apply) return 'ready';
  // setCustomUserClaims remplace l'objet : préserver les claims existants.
  await auth.setCustomUserClaims(ADMIN_UID, { ...account.customClaims, admin: true });
  const updated = await auth.getUser(ADMIN_UID);
  if (updated.customClaims?.admin !== true) throw new Error('Attribution non confirmée');
  return 'granted';
}
async function main(args) {
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) throw new Error('Utiliser --check ou --apply. Aucun autre UID ne peut être fourni.');
  const result = await grantAdmin(await getFirebaseAuth({ bootstrap: true }), args[0] === '--apply');
  console.log(`Projet : ${PROJECT_ID}\nUID autorisé : ${ADMIN_UID}`);
  console.log({ ready: 'Vérification OK. Relancer avec --apply pour attribuer admin: true.', 'already-admin': 'Ce compte est déjà administrateur. Aucune modification.', granted: 'Claim admin: true attribué et vérifié. Actualiser le jeton sur /admin.' }[result]);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Ne pas afficher d'objet d'erreur SDK susceptible de contenir des détails d'identification.
  console.error('Attribution non effectuée. Vérifiez les identifiants ADC, le projet et les permissions IAM. Code :', error.code || 'ADMIN_SETUP_FAILED');
  process.exitCode = 1;
});
module.exports = { grantAdmin, main };
