const {getFirebaseAuth}=require('./firebase-admin.cjs');
const {HttpError}=require('./policy.cjs');
let instance;
async function getCatalogueFirestore(){
  if(instance)return instance;
  if(process.env.FIRESTORE_EMULATOR_HOST&&(process.env.NODE_ENV==='production'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)))throw new HttpError(503,'CATALOGUE_EMULATOR_FORBIDDEN');
  // Même identité ADC vérifiée que Firebase Auth ; aucune nouvelle clé privée.
  const auth=await getFirebaseAuth();
  const {getFirestore}=require('firebase-admin/firestore');instance=getFirestore(auth.app);instance.settings({preferRest:true});return instance;
}
module.exports={getCatalogueFirestore};
