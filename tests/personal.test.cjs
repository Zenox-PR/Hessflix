const {test}=require('node:test');const assert=require('node:assert/strict');
const {once}=require('node:events');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {randomUUID}=require('node:crypto');
const {createMovixServer}=require('../server.cjs');const {createCloudProfiles,createPersonalStore}=require('../server/personal-store.cjs');const {createProfileRepository}=require('../server/viewer-profiles.cjs');
const {createTestFirestore}=require('./fixtures/catalogue-db.cjs');const model=require('../personal-model.js');
const origin='http://localhost:4180',a=randomUUID(),b=randomUUID(),film='movie-tt0816692',series='tmdb-tv-66732';
async function fixture(work,{failed=false}={}){
 const db=createTestFirestore(),server=createMovixServer({origin,getFirestore:async()=>{if(failed)throw new Error('Unavailable');return db;},getAuth:()=>({async verifyIdToken(token,check){assert.equal(check,true);const uid=['alice','bob'].find(uid=>token==='personal-test-token-for-'+uid);if(!uid)throw new Error('Invalid');return {uid,admin:uid==='bob'};}})});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const request=(uid,method='GET',id='primary',body,headers={})=>fetch(base+'/api/personal/'+id,{method,headers:{Origin:origin,Authorization:'Bearer personal-test-token-for-'+uid,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const post=(uid,device,operations,id='primary')=>request(uid,'POST',id,{device,operations});
 try{await work({db,request,post,base});}finally{await new Promise(resolve=>server.close(resolve));}
}
test('listes : authentification révoquée vérifiée, origine exacte et schéma fermé',()=>fixture(async({request})=>{
 assert.equal((await request('unknown')).status,401);
 assert.equal((await request('alice','POST','primary',{device:a,operations:[{seq:1,type:'favorite',id:film,value:true}]},{Origin:'https://evil.invalid'})).status,403);
 for(const body of [{uid:'bob',device:a,operations:[]},{device:a,operations:[{seq:1,type:'favorite',id:film,value:true,admin:true}]},{device:a,operations:[{seq:0,type:'favorite',id:film,value:true}]},{device:a,operations:[{seq:1,type:'favorite',id:'../../bob',value:true}]}])assert.equal((await request('alice','POST','primary',body)).status,400);
 const response=await request('alice');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual((await response.json()).state.favorites,[]);
}));
test('listes : comptes isolés, même un autre administrateur ne lit pas le profil privé',()=>fixture(async({db,post,request})=>{
 const profile=randomUUID();db.data.set('viewerAccounts/alice',{version:1,profiles:[{id:profile,displayName:'Papa',photoURL:''}]});
 assert.equal((await post('alice',a,[{seq:1,type:'favorite',id:film,value:true}],profile)).status,200);
 assert.equal((await request('bob','GET',profile)).status,404);assert.equal((await post('bob',a,[{seq:1,type:'favorite',id:film,value:true}],profile)).status,404);
 assert.deepEqual((await(await request('alice')).json()).state.favorites,[]);assert.deepEqual((await(await request('bob')).json()).state.favorites,[]);
 assert.deepEqual((await(await request('alice','GET',profile)).json()).state.favorites,[film]);
 db.data.set('viewerAccounts/alice',{version:1,profiles:[]});assert.equal((await request('alice','GET',profile)).status,404);
 assert.ok(db.data.has('viewerAccounts/alice/personal/'+profile),'Les données du profil supprimé ne sont pas détruites silencieusement.');
}));
test('listes : deux appareils, opérations fusionnées sans écrasement et retransmission idempotente',()=>fixture(async({post,request})=>{
 const ops=[{seq:1,type:'favorite',id:film,value:true},{seq:2,type:'watchlist',id:series,value:true}];assert.equal((await post('alice',a,ops)).status,200);
 assert.equal((await post('alice',b,[{seq:1,type:'favorite',id:series,value:true}])).status,200);
 assert.equal((await post('alice',a,ops)).status,200);let state=(await(await request('alice')).json()).state;
 assert.deepEqual(new Set(state.favorites),new Set([film,series]));assert.deepEqual(state.watchlist,[series]);
 assert.equal((await post('alice',a,[{seq:3,type:'favorite',id:film,value:false}])).status,200);
 state=(await(await request('alice')).json()).state;assert.deepEqual(state.favorites,[series]);
}));
test('listes : numérotation et validation atomiques, aucune écriture partielle',()=>fixture(async({post,request})=>{
 assert.equal((await post('alice',a,[{seq:2,type:'favorite',id:film,value:true}])).status,409);
 assert.equal((await post('alice',a,[{seq:1,type:'favorite',id:film,value:true},{seq:3,type:'watchlist',id:series,value:true}])).status,409);
 assert.deepEqual((await(await request('alice')).json()).state.favorites,[]);
}));
test('listes : saisons, épisodes vus et sélection conservés sans doublon',()=>fixture(async({post,request})=>{
 const choice={season:2,episode:3},ops=[{seq:1,type:'selection',id:series,choice},{seq:2,type:'status',id:series,status:'completed',choice,episodeCount:20,at:100}];
 await post('alice',a,ops);await post('alice',a,ops);const state=(await(await request('alice')).json()).state;
 assert.deepEqual(state.selections[series],choice);assert.equal(state.history.length,1);assert.equal(state.progress[0].status,'in-progress');assert.deepEqual(state.history[0].choice,choice);
}));
test('listes : panne Firestore explicite, jamais une fausse sauvegarde',()=>fixture(async({post,request})=>{
 assert.equal((await request('alice')).status,503);assert.equal((await post('alice',a,[{seq:1,type:'favorite',id:film,value:true}])).status,503);
},{failed:true}));
test('migration : anciens profils serveur conservés, identifiants stables et pas de résurrection',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hessflix-migration-'));
 try{const legacy=createProfileRepository(directory),[old]=await legacy.create('alice',{displayName:'Papa'}),files=await fs.readdir(directory);const db=createTestFirestore(),profiles=createCloudProfiles({getFirestore:async()=>db,legacyDirectory:directory});
 assert.equal((await profiles.read('alice'))[0].id,old.id);await profiles.remove('alice',old.id);assert.deepEqual(await profiles.read('alice'),[]);assert.deepEqual(await fs.readdir(directory),files);
 const personal=createPersonalStore({getFirestore:async()=>db,profiles});await assert.rejects(()=>personal.get('alice',old.id),error=>error.status===404);
 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('hessflix-migration-'));await fs.rm(directory,{recursive:true,force:true});}
});
test('migration : union idempotente, suppression récente prioritaire sur ancien favori',()=>{
 const state=model.empty(),importOp={type:'import',source:'a'.repeat(64),data:{favorites:[film,series],watchlist:[],progress:[],history:[],seconds:20,days:{'2026-10-25':20}}};
 model.apply(state,{type:'favorite',id:film,value:false});model.apply(state,importOp);model.apply(state,importOp);assert.deepEqual(state.favorites,[series]);assert.equal(state.seconds,20);
});
test('activité : intervalles simultanés non doublés et données compatibles Firestore',()=>{
 const state=model.empty();for(const [start,end]of [[1000,11000],[6000,16000],[1000,11000]])model.apply(state,{type:'time',start,end,day:'2026-10-25'});
 assert.equal(state.seconds,15);assert.equal(state.days['2026-10-25'],15);assert.deepEqual(state.windows,[{start:1000,end:16000}]);
 function noNestedArrays(value){if(Array.isArray(value)){assert.ok(value.every(item=>!Array.isArray(item)));value.forEach(noNestedArrays);}else if(value&&typeof value==='object')Object.values(value).forEach(noNestedArrays);}noNestedArrays(state);
});
test('limites : les listes pleines refusent explicitement les ajouts supplémentaires',()=>{
 const state=model.empty();for(let id=1;id<=500;id++)model.apply(state,{type:'favorite',id:'tmdb-movie-'+id,value:true});assert.throws(()=>model.apply(state,{type:'favorite',id:'tmdb-movie-501',value:true}));assert.equal(state.favorites.length,500);
});
test('identifiants : UID personnalisé encodé, aucun chemin Firestore détourné',async()=>{
 const db=createTestFirestore(),profiles={read:async()=>[]},store=createPersonalStore({getFirestore:async()=>db,profiles});await store.apply('alice/personal/primary','primary',a,[{seq:1,type:'favorite',id:film,value:true}]);
 assert.ok(db.data.has('viewerAccounts/alice%2Fpersonal%2Fprimary/personal/primary'));assert.deepEqual((await store.get('alice','primary')).favorites,[]);
 assert.equal(model.validId('movie-tt'+'1'.repeat(100)),false);
});
test('données corrompues : refus explicite sans remplacer le document existant',()=>fixture(async({db,request,post})=>{
 const invalid={version:1,favorites:['broken']};db.data.set('viewerAccounts/alice/personal/primary',invalid);assert.equal((await request('alice')).status,503);assert.equal((await post('alice',a,[{seq:1,type:'favorite',id:film,value:true}])).status,503);assert.deepEqual(db.data.get('viewerAccounts/alice/personal/primary'),invalid);
}));
