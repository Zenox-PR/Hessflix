const {test}=require('node:test');const assert=require('node:assert/strict');const {once}=require('node:events');
const {createMovixServer}=require('../server.cjs');const {createCatalogueStore}=require('../server/catalogue-store.cjs');const {createTMDBClient}=require('../server/tmdb-client.cjs');const {ADMIN_UID}=require('../server/policy.cjs');
const {createTestFirestore}=require('./fixtures/catalogue-db.cjs');const {movie,tv}=require('./fixtures/tmdb.cjs');const {media}=require('../server/tmdb-model.cjs');
const evil={...movie,id:1576,title:'Resident Evil',original_title:'Resident Evil',release_date:'2002-03-15',imdb_id:'tt0120804'};
const ORIGIN='http://localhost:4180';
async function fixture(work,{failed=false,identity={uid:ADMIN_UID,admin:true},revoked=false}={}){
 const db=createTestFirestore(),store=createCatalogueStore({getFirestore:async()=>{if(failed)throw new Error('SERVICE_DISABLED');return db;}});
 const auth={verifySessionCookie:async(value,check)=>{assert.equal(check,true);if(value!=='owner-session'||revoked)throw new Error('Invalid');return identity;},getUser:async()=>({uid:identity.uid,disabled:false,customClaims:{admin:identity.admin}})};
 const tmdbClient=createTMDBClient({apiKey:()=> '0'.repeat(32),fetchImpl:async url=>{const path=url.pathname.slice(2);if(path==='/movie/1576')return Response.json(evil);if(path==='/tv/66732')return Response.json(tv);if(path.includes('/search/'))return Response.json({results:[evil],page:1,total_pages:1});if(path.startsWith('/genre/'))return Response.json({genres:[]});if(path.includes('/season/'))return Response.json({episodes:[1,2].map(number=>({id:number+500,episode_number:number,name:'Épisode '+number,overview:'Description',air_date:'2020-01-01',runtime:24}))});return new Response('{}',{status:404});}});
 const server=createMovixServer({getAuth:()=>auth,catalogueStore:store,tmdbClient,origin:ORIGIN});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const get=async(path,cookie='movix_admin=owner-session')=>fetch(base+path,{headers:{Cookie:cookie}});
 async function write(path,method,payload,cookie='movix_admin=owner-session'){
  const csrf=await get('/api/admin/csrf',cookie),data=await csrf.json(),csrfCookie=csrf.headers.getSetCookie()[0].split(';')[0];
  return fetch(base+path,{method,headers:{Cookie:cookie+'; '+csrfCookie,Origin:ORIGIN,'X-CSRF-Token':data.csrfToken,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 }
 try{await work({db,store,get,write,base});}finally{await new Promise(resolve=>server.close(resolve));}
}
test('catalogue : toutes les routes admin et TMDB refusent les visiteurs et utilisateurs classiques',async()=>{
 for(const identity of [{uid:'regular',admin:false},{uid:'other',admin:true},{uid:ADMIN_UID,admin:'true'}])await fixture(async({get,write})=>{
  for(const route of ['/api/admin/catalogue','/api/admin/catalogue/status','/api/admin/catalogue/legacy','/api/admin/tmdb/search?query=Resident%20Evil','/api/tmdb/detail/movie/1576'])assert.ok([401,403].includes((await get(route)).status),route);
  assert.ok([401,403].includes((await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576})).status));
 },{identity});
 await fixture(async({get})=>assert.equal((await get('/api/admin/catalogue','')).status,401));
});
test('catalogue : Resident Evil 2002, brouillon par défaut et doublons atomiquement refusés',async()=>fixture(async({write,get})=>{
 const search=await get('/api/admin/tmdb/search?query=Resident%20Evil&category=Film');assert.equal(search.status,200);assert.equal((await search.json()).items[0].year,'2002');
 const responses=await Promise.all([write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576}),write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576})]);assert.deepEqual(responses.map(value=>value.status).sort(),[201,409]);
 assert.equal((await get('/api/catalogue/tmdb-movie-1576')).status,404);const items=await(await get('/api/catalogue')).json();assert.equal(items.items.length,0);
 const result=await(await get('/api/admin/catalogue/tmdb-movie-1576')).json();assert.equal(result.entry.status,'draft');
}));
test('catalogue : publication, masquage et accès direct contrôlés sans repli statique',async()=>fixture(async({write,get})=>{
 let result=await(await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576})).json();
 result=await(await write('/api/admin/catalogue/tmdb-movie-1576','PATCH',{version:result.entry.version,status:'published'})).json();
 assert.equal((await get('/api/catalogue/tmdb-movie-1576')).status,200);assert.equal((await(await get('/api/catalogue?query=resident')).json()).items.length,1);
 let script=await(await get('/catalogue-data.js')).text();assert.ok(script.includes('Resident Evil'));assert.ok(!script.includes('Interstellar'));
 await write('/api/admin/catalogue/tmdb-movie-1576','PATCH',{version:result.entry.version,status:'hidden'});
 assert.equal((await get('/api/catalogue/tmdb-movie-1576')).status,404);assert.ok(!(await(await get('/catalogue-data.js')).text()).includes('Resident Evil'));
 for(const file of ['discovery-data.js','platform-catalogue-data.js','episode-data.js'])assert.equal((await get('/'+file)).status,404);
}));
test('catalogue : actualiser TMDB conserve corrections, catégorie, état et visibilité',async()=>fixture(async({store})=>{
 const original=await store.create(media(evil,'movie'),'Film',ADMIN_UID);let saved=await store.patch(original.id,1,ADMIN_UID,{editor:{title:'Mon titre',overview:'Mon synopsis',category:'Anime',featured:true,rank:4},status:'published'});
 const refreshed=await store.refresh(original.id,saved.entry.version,ADMIN_UID,media({...evil,title:'Nouveau titre TMDB',overview:'Nouveau synopsis TMDB'},'movie'));
 assert.equal(refreshed.entry.editor.title,'Mon titre');assert.equal(refreshed.entry.editor.category,'Anime');assert.equal(refreshed.entry.status,'published');assert.equal((await store.publicGet(original.id)).title,'Mon titre');assert.equal(refreshed.entry.meta.title,'Nouveau titre TMDB');
 await assert.rejects(store.patch(original.id,1,ADMIN_UID,{editor:{title:'Écrasement'}}),error=>error.status===409);
}));
test('catalogue : saisons et épisodes individuels, aucun nouvel épisode publié automatiquement',async()=>fixture(async({write,get})=>{
 let state=await(await write('/api/admin/catalogue','POST',{mediaType:'tv',tmdbId:66732,category:'Série'})).json();const root='/api/admin/catalogue/'+state.entry.id;
 state=await(await write(root+'/seasons/1/import','POST',{version:state.entry.version})).json();assert.equal(state.seasons[0].published,false);
 state=await(await write(root,'PATCH',{version:state.entry.version,status:'published'})).json();assert.equal((await get('/api/catalogue/'+state.entry.id+'/seasons/1')).status,404);
 state=await(await write(root+'/seasons/1/episodes/1','PATCH',{version:state.entry.version,published:true,editor:{title:'Titre personnalisé'}})).json();
 state=await(await write(root+'/seasons/1','PATCH',{version:state.entry.version,published:true})).json();
 let guide=await(await get('/api/catalogue/'+state.entry.id+'/seasons/1')).json();assert.equal(guide.episodes.length,1);assert.equal(guide.episodes[0].title,'Titre personnalisé');
 state=await(await write(root+'/seasons/1/import','POST',{version:state.entry.version})).json();guide=await(await get('/api/catalogue/'+state.entry.id+'/seasons/1')).json();assert.equal(guide.episodes.length,1);assert.equal(guide.episodes[0].title,'Titre personnalisé');
 state=await(await write(root,'PATCH',{version:state.entry.version,status:'hidden'})).json();assert.equal((await get('/api/catalogue/'+state.entry.id+'/seasons/1')).status,404);
}));
test('catalogue : corbeille, restauration en brouillon et suppression des sous-collections',async()=>fixture(async({write,get,db})=>{
 let state=await(await write('/api/admin/catalogue','POST',{mediaType:'tv',tmdbId:66732})).json();const root='/api/admin/catalogue/'+state.entry.id;
 state=await(await write(root+'/seasons/1/import','POST',{version:state.entry.version})).json();state=await(await write(root+'/trash','POST',{version:state.entry.version})).json();
 assert.equal(state.entry.status,'deleted');assert.equal((await get('/api/catalogue/'+state.entry.id)).status,404);
 state=await(await write(root+'/restore','POST',{version:state.entry.version})).json();assert.equal(state.entry.status,'draft');
 state=await(await write(root+'/trash','POST',{version:state.entry.version})).json();assert.equal((await write(root,'DELETE',{version:state.entry.version,confirmation:'incorrect'})).status,400);
 assert.equal((await write(root,'DELETE',{version:state.entry.version,confirmation:state.entry.id})).status,200);assert.ok(![...db.data.keys()].some(key=>key.includes(state.entry.id)));
}));

test('catalogue : une renumérotation TMDB ne transfère jamais une validation à un autre épisode',async()=>fixture(async({store,db})=>{
 const entry=await store.create(media(tv,'tv'),'Série',ADMIN_UID),guide={episodes:[{number:1,tmdbId:501,title:'Original'}]};
 let state=await store.importSeason(entry.id,entry.version,ADMIN_UID,1,guide);
 state=await store.patchEpisode(entry.id,state.entry.version,ADMIN_UID,1,1,{published:true,editor:{title:'Correction'}});
 state=await store.refresh(entry.id,state.entry.version,ADMIN_UID,{tmdbSeasons:[{number:1,title:'Saison actualisée',airdate:'2020-01-02'}]});
 state=await store.importSeason(entry.id,state.entry.version,ADMIN_UID,1,guide);
 assert.equal(state.seasons[0].title,'Saison actualisée');assert.equal(state.seasons[0].publishedEpisodes,1);
 const before=JSON.stringify([...db.data]);
 await assert.rejects(store.importSeason(entry.id,state.entry.version,ADMIN_UID,1,{episodes:[{number:1,tmdbId:999,title:'Autre épisode'}]}),error=>error.code==='CATALOGUE_NUMBERING_CHANGED');
 assert.equal(JSON.stringify([...db.data]),before);
 state=await store.importSeason(entry.id,state.entry.version,ADMIN_UID,1,{episodes:[]});
 const preserved=(await store.season(entry.id,1)).episodes[0];assert.equal(preserved.obsolete,true);assert.equal(preserved.published,true);assert.equal(preserved.editor.title,'Correction');
}));
test('catalogue : CSRF, origine, champs de rôles et versions invalides refusés',async()=>fixture(async({write,get,base})=>{
 assert.equal((await fetch(base+'/api/admin/catalogue',{method:'POST',headers:{Cookie:'movix_admin=owner-session',Origin:ORIGIN,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576,admin:true})).status,400);
 const state=await(await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576})).json();const root='/api/admin/catalogue/'+state.entry.id;
 assert.equal((await write(root,'PATCH',{version:state.entry.version,editor:{role:'admin'}})).status,400);assert.equal((await write(root,'PATCH',{status:'published'})).status,400);
 assert.equal((await get('/api/catalogue/../../server.cjs')).status,404);
}));
test('catalogue : Firestore indisponible échoue fermé et ne confirme aucun faux succès',async()=>fixture(async({get,write})=>{
 const health=await(await get('/api/admin/catalogue/status')).json();assert.equal(health.firestore,false);
 assert.equal((await get('/api/catalogue')).status,503);const script=await get('/catalogue-data.js');assert.equal(script.status,503);assert.match(await script.text(),/unavailable/);
 assert.equal((await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576})).status,503);
},{failed:true}));

test('catalogue : choix de plusieurs plateformes, publication, déplacement et retrait effectifs',async()=>fixture(async({write,get})=>{
 const created=await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576,platforms:['marvel','netflix','prime-video','netflix']});assert.equal(created.status,201);
 let state=await created.json();const path='/api/admin/catalogue/'+state.entry.id;
 assert.deepEqual(state.entry.editor.platforms,['netflix','prime-video','marvel']);
 const originalOffers=state.entry.meta.availability||[];
 for(const provider of ['netflix','prime-video','marvel'])assert.equal((await(await get('/api/catalogue?provider='+provider)).json()).items.length,0);
 state=await(await write(path,'PATCH',{version:state.entry.version,status:'published'})).json();
 for(const provider of ['netflix','prime-video','marvel'])assert.equal((await(await get('/api/catalogue?provider='+provider)).json()).items.length,1);
 for(const provider of ['disney','paramount'])assert.equal((await(await get('/api/catalogue?provider='+provider)).json()).items.length,0);
 const context={window:{}};require('node:vm').runInNewContext(await(await get('/catalogue-data.js')).text(),context);
 assert.equal(context.window.MovixPlatformCatalogue.providers.marvel.itemIds.length,1);assert.equal(context.window.MovixPlatformCatalogue.providers.disney.itemIds.length,0);
 state=await(await write(path,'PATCH',{version:state.entry.version,editor:{platforms:['disney']}})).json();
 assert.equal((await(await get('/api/catalogue?provider=netflix')).json()).items.length,0);assert.equal((await(await get('/api/catalogue?provider=disney')).json()).items.length,1);
 state=await(await write(path+'/refresh','POST',{version:state.entry.version})).json();
 assert.deepEqual(state.entry.editor.platforms,['disney']);assert.deepEqual(state.entry.meta.availability||[],originalOffers);
 assert.deepEqual((await(await get('/api/catalogue/'+state.entry.id)).json()).item.platforms,['disney']);
 state=await(await write(path,'PATCH',{version:state.entry.version,editor:{platforms:[]}})).json();
 assert.equal((await(await get('/api/catalogue')).json()).items.length,1);
 for(const provider of ['netflix','prime-video','paramount','disney','marvel'])assert.equal((await(await get('/api/catalogue?provider='+provider)).json()).items.length,0);
}));

test('catalogue : plateformes validées côté serveur, champs inconnus refusés et anime classé',async()=>fixture(async({write,get,db})=>{
 const before=db.data.size;
 for(const platforms of ['netflix',null,{},['unknown'],['netflix',true],['netflix','disney','marvel','paramount','prime-video','netflix']]){
  const response=await write('/api/admin/catalogue','POST',{mediaType:'movie',tmdbId:1576,platforms});assert.equal(response.status,400);assert.equal((await response.json()).error,'CATALOGUE_INVALID_PLATFORMS');
 }
 assert.equal(db.data.size,before);
 let state=await(await write('/api/admin/catalogue','POST',{mediaType:'tv',tmdbId:66732,category:'Anime',platforms:['paramount','disney']})).json();
 const path='/api/admin/catalogue/'+state.entry.id;
 const invalid=await write(path,'PATCH',{version:state.entry.version,editor:{platforms:['not-a-platform']}});assert.equal(invalid.status,400);
 assert.equal((await(await get(path)).json()).entry.version,state.entry.version);
 state=await(await write(path,'PATCH',{version:state.entry.version,status:'published'})).json();
 const page=await(await get('/api/catalogue?kind=Anime&provider=paramount')).json();assert.equal(page.items.length,1);assert.equal(page.items[0].isAnime,true);
 assert.equal((await write(path,'PATCH',{version:state.entry.version,editor:{platforms:['netflix']},admin:true})).status,400);
}));

test('catalogue : anciennes offres conservées tant qu’aucun choix manuel n’est enregistré',async()=>fixture(async({store})=>{
 const offer={platform:'netflix',country:'FR',type:'subscription',watchURL:'https://www.netflix.com/title/123',sourceURL:'https://www.justwatch.com/fr/film/test',checkedAt:'2026-10-25T00:00:00Z'};
 const entry=await store.create({...media(evil,'movie'),availability:[offer]},'Film',ADMIN_UID);
 let state=await store.patch(entry.id,1,ADMIN_UID,{status:'published'});assert.deepEqual((await store.publicGet(entry.id)).platforms,['netflix']);
 state=await store.patch(entry.id,state.entry.version,ADMIN_UID,{editor:{platforms:[]}});assert.deepEqual((await store.publicGet(entry.id)).platforms,[]);
 state=await store.refresh(entry.id,state.entry.version,ADMIN_UID,{availability:[offer]});assert.deepEqual((await store.publicGet(entry.id)).platforms,[]);
}));
