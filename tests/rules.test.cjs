const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { ADMIN_UID } = require('../server/policy.cjs');
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-movix-admin',
    firestore: { host: '127.0.0.1', port: 8455, rules: fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8') },
    storage: { host: '127.0.0.1', port: 9455, rules: fs.readFileSync(path.join(__dirname,'../storage.rules'),'utf8') },
    database: { host: '127.0.0.1', port: 9255, rules: fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8') }
  });
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('admin/status').set({protected:true});
    await context.firestore().doc('catalogueEntries/tmdb-movie-1576').set({status:'draft',editor:{title:'Privé'}});
    await context.firestore().doc('catalogueEntries/tmdb-tv-66732/seasons/1/episodes/1').set({published:false});
    await context.firestore().doc('publicCatalogue/tmdb-movie-1576').set({status:'published',title:'Publié'});
    await context.firestore().doc('publicCatalogue/tmdb-movie-99').set({status:'hidden',title:'Non publié'});
    await context.storage().ref('admin/status.txt').putString('protected');
    await context.database().ref('admin/status').set({protected:true});
  });
});
after(async () => { await env?.cleanup(); });
function identities() {
  return [env.unauthenticatedContext(),env.authenticatedContext('regular-user'),env.authenticatedContext(ADMIN_UID),env.authenticatedContext('other-user',{admin:true}),env.authenticatedContext(ADMIN_UID,{admin:'true'})];
}

test('Firestore : listes et profils spectateurs accessibles uniquement via le serveur authentifié',async()=>{
 for(const context of [...identities(),env.authenticatedContext(ADMIN_UID,{admin:true})])for(const target of ['viewerAccounts/regular-user','viewerAccounts/regular-user/personal/primary']){
  await assertFails(context.firestore().doc(target).get());await assertFails(context.firestore().doc(target).set({favorites:['tmdb-movie-1576']}));await assertFails(context.firestore().doc(target).delete());
 }
});

test('Firestore catalogue : aucun client ne lit les brouillons ni ne publie directement, même administrateur',async()=>{
 for(const context of [...identities(),env.authenticatedContext(ADMIN_UID,{admin:true})]){
   const db=context.firestore();
   for(const target of ['catalogueEntries/tmdb-movie-1576','catalogueEntries/tmdb-tv-66732/seasons/1/episodes/1']){
     await assertFails(db.doc(target).get());await assertFails(db.doc(target).set({published:true}));await assertFails(db.doc(target).delete());
   }
   await assertSucceeds(db.doc('publicCatalogue/tmdb-movie-1576').get());
   await assertFails(db.doc('publicCatalogue/tmdb-movie-99').get());
   await assertFails(db.collection('publicCatalogue').get());
   await assertSucceeds(db.collection('publicCatalogue').where('status','==','published').get());
   await assertFails(db.doc('publicCatalogue/tmdb-movie-1576').update({title:'Pirate'}));
   await assertFails(db.doc('publicCatalogue/tmdb-movie-99').set({status:'published'}));
 }
});
test('Firestore : seul le bon UID avec admin booléen lit/écrit les données admin', async () => {
  for (const context of identities()) {
    await assertFails(context.firestore().doc('admin/status').get());
    await assertFails(context.firestore().doc('admin/forged').set({admin:true}));
  }
  const admin=env.authenticatedContext(ADMIN_UID,{admin:true});
  await assertSucceeds(admin.firestore().doc('admin/status').get());
  await assertSucceeds(admin.firestore().doc('admin/allowed').set({ok:true}));
});
test('Firestore : un profil ne peut pas contenir un rôle ni modifier un autre profil', async () => {
  const user=env.authenticatedContext('regular-user').firestore();
  await assertSucceeds(user.doc('profiles/regular-user').set({displayName:'Profil'}));
  await assertSucceeds(user.doc('profiles/regular-user').update({displayName:'Nouveau nom',photoURL:'https://example.com/avatar.png'}));
  await assertFails(user.doc('profiles/regular-user').update({admin:true}));
  await assertFails(user.doc('profiles/regular-user').update({role:'admin'}));
  await assertFails(user.doc('profiles/regular-user').update({customClaims:{admin:true}}));
  await assertFails(user.doc('profiles/another-user').set({displayName:'Faux'}));
  await assertFails(user.doc('roles/regular-user').set({admin:true}));
  const stored=await user.doc('profiles/regular-user').get();assert.equal(stored.data().admin,undefined);
});
test('Storage : lecture et écriture admin refusées aux visiteurs et autres comptes', async () => {
  for (const context of identities()) {
    await assertFails(context.storage().ref('admin/status.txt').getMetadata());
    await assertFails(context.storage().ref('admin/forged.txt').putString('forged'));
  }
  const admin=env.authenticatedContext(ADMIN_UID,{admin:true});
  await assertSucceeds(admin.storage().ref('admin/status.txt').getMetadata());
  await assertSucceeds(admin.storage().ref('admin/allowed.txt').putString('ok'));
});
test('Realtime Database : lecture et écriture admin exigent UID et claim', async () => {
  for (const context of identities()) {
    await assertFails(context.database().ref('admin/status').once('value'));
    await assertFails(context.database().ref('admin/forged').set({admin:true}));
  }
  const admin=env.authenticatedContext(ADMIN_UID,{admin:true});
  await assertSucceeds(admin.database().ref('admin/status').once('value'));
  await assertSucceeds(admin.database().ref('admin/allowed').set({ok:true}));
});
test('Realtime Database : aucune auto-attribution par écriture de profil ou de rôle', async () => {
  const user=env.authenticatedContext('regular-user').database();
  await assertSucceeds(user.ref('profiles/regular-user').set({displayName:'Profil'}));
  await assertFails(user.ref('profiles/regular-user/admin').set(true));
  await assertFails(user.ref('profiles/regular-user/role').set('admin'));
  await assertFails(user.ref('roles/regular-user').set({admin:true}));
});
test('Firestore : schéma profil, valeurs nulles, tableaux et URL malformées refusés', async () => {
  const profile = env.authenticatedContext('schema-user').firestore().doc('profiles/schema-user');
  for (const photoURL of ['', 'https://example.com/avatar.png?size=128']) await assertSucceeds(profile.set({ displayName: 'Profil', photoURL }));
  for (const photoURL of [null, {}, [], 7, 'http://example.com/a', 'javascript:alert(1)', 'https://example.com/a b', 'https://a@b/x', 'https://example.com/' + 'x'.repeat(2048)]) await assertFails(profile.set({ displayName: 'Profil', photoURL }));
  for (const displayName of [null, {}, [], '', 'x'.repeat(61)]) await assertFails(profile.set({ displayName }));
  await assertSucceeds(profile.set({ displayName: 'x'.repeat(60) }));
  await assertFails(profile.update({ photoURL: {} }));
});
test('Realtime Database : même schéma de profil, suppression du champ facultatif autorisée', async () => {
  const profile = env.authenticatedContext('schema-user').database().ref('profiles/schema-user');
  for (const photoURL of ['', 'https://example.com/avatar.png?size=128']) await assertSucceeds(profile.set({ displayName: 'Profil', photoURL }));
  for (const photoURL of [7, { bad: true }, ['bad'], 'http://example.com/a', 'javascript:alert(1)', 'https://example.com/a b', 'https://a@b/x', 'https://example.com/' + 'x'.repeat(2048)]) await assertFails(profile.set({ displayName: 'Profil', photoURL }));
  // Conserver un champ : RTDB transforme un objet entièrement null en suppression du profil.
  for (const displayName of [null, { bad: true }, ['bad'], '', 'x'.repeat(61)]) await assertFails(profile.set({ displayName, photoURL: 'https://example.com/avatar.png' }));
  await assertSucceeds(profile.set({ displayName: 'x'.repeat(60) }));
  await assertSucceeds(profile.update({ photoURL: null }));
});
