const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const {createMovixServer}=require('../server.cjs');
const {createTMDBClient}=require('../server/tmdb-client.cjs');
const {media}=require('../server/tmdb-model.cjs');
const {fakeTMDB,movie,tv,anime}=require('./fixtures/tmdb.cjs');
const {ADMIN_UID}=require('../server/policy.cjs');
// Les métadonnées brutes sont désormais privées : ces tests utilisent une session admin vérifiée.
const fetch=(url,options={})=>globalThis.fetch(url,{...options,headers:{Cookie:'movix_admin=tmdb-test-session',...options.headers}});
const SENTINEL='0'.repeat(32); // Clé fictive, jamais utilisée contre TMDB.
const client=(options={})=>createTMDBClient({apiKey:()=>SENTINEL,fetchImpl:async url=>Response.json(fakeTMDB(url)),...options});
async function serve(tmdbClient,callback){const server=createMovixServer({tmdbClient,getAuth:()=>({verifySessionCookie:async(value,revoked)=>{assert.equal(value,'tmdb-test-session');assert.equal(revoked,true);return {uid:ADMIN_UID,admin:true};},getUser:async()=>({disabled:false,customClaims:{admin:true}})})});server.listen(0,'127.0.0.1');await once(server,'listening');try{await callback('http://127.0.0.1:'+server.address().port);}finally{await new Promise(resolve=>server.close(resolve));}}
test('TMDB : clé absente, statut sans secret et routes privées non exposées',async()=>{
  let calls=0;
  await serve(client({apiKey:()=>'',fetchImpl:async()=>{calls++;throw new Error();}}),async base=>{
    assert.deepEqual(await(await fetch(base+'/api/tmdb/status')).json(),{configured:false});
    assert.equal((await fetch(base+'/api/tmdb/detail/movie/157336')).status,503);
    for(const file of ['.env','.env.example','server/tmdb-client.cjs','scripts/check-tmdb.cjs','tests/fixtures/tmdb.cjs','.data/tmdb-cache'])assert.equal((await fetch(base+'/'+file)).status,404);
  });assert.equal(calls,0);
});
test('TMDB : film complet normalisé, langue française et clé limitée à la requête serveur',async()=>{
  const urls=[];await serve(client({fetchImpl:async url=>{urls.push(url);return Response.json({...fakeTMDB(url),api_key:SENTINEL});}}),async base=>{
    const response=await fetch(base+'/api/tmdb/detail/movie/157336');assert.equal(response.status,200);
    const body=await response.text();assert.ok(!body.includes(SENTINEL));const {item}=JSON.parse(body);
    assert.equal(item.tmdbId,157336);assert.equal(item.mediaType,'movie');assert.equal(item.title,'Interstellar');assert.equal(item.runtime,169);assert.equal(item.year,'2014');assert.equal(item.ratingSource,'TMDB');assert.equal(item.votes,12345);assert.equal(item.releaseDate,'2014-11-05');assert.match(item.backdrop,/^https:\/\/image\.tmdb\.org/);assert.deepEqual(item.genres,['Science-fiction']);
  });assert.ok(urls.every(url=>url.origin==='https://api.themoviedb.org'&&url.searchParams.get('language')==='fr-FR'&&url.searchParams.get('api_key')===SENTINEL));
});
test('TMDB : série, anime et animation non japonaise correctement distingués',async()=>{
  assert.equal(media(anime,'tv').isAnime,true);assert.equal(media({...anime,original_language:'en',origin_country:['US']},'tv').isAnime,false);
  assert.equal(media({...anime,genre_ids:[],genres:[]},'tv').isAnime,false);
  assert.equal(media({...movie,adult:true},'movie'),null);assert.equal(media({...movie,poster_path:'//evil.invalid/x.jpg'},'movie').image,'');
  await serve(client(),async base=>{
    const {item}=await(await fetch(base+'/api/tmdb/detail/tv/66732')).json();assert.equal(item.seasonCount,2);assert.equal(item.episodeCount,4);assert.equal(item.tmdbSeasons.length,2);
    const result=await(await fetch(base+'/api/tmdb/browse?category=Anime&section=popular')).json();assert.ok(result.items.length>0);assert.ok(result.items.every(item=>item.isAnime));
  });
});
test('TMDB : repli anglais des synopsis sans perdre le titre français, épisodes réels normalisés',async()=>{
  await serve(client({fetchImpl:async url=>{const value=fakeTMDB(url);if(url.pathname==='/3/movie/157336')return Response.json({...value,title:url.searchParams.get('language')==='fr-FR'?'Titre français':'English title',overview:url.searchParams.get('language')==='fr-FR'?'':'English fallback.'});if(url.pathname.includes('/season/')&&url.searchParams.get('language')==='fr-FR')value.episodes[0].overview='';return Response.json(value);}}),async base=>{
    const {item}=await(await fetch(base+'/api/tmdb/detail/movie/157336')).json();assert.equal(item.title,'Titre français');assert.equal(item.overview,'English fallback.');assert.equal(item.metadataLanguage,'en-US');
    const guide=await(await fetch(base+'/api/tmdb/season/66732/2')).json();assert.equal(guide.episodes[0].season,2);assert.equal(guide.episodes[0].title,'Épisode de test 1');assert.equal(guide.episodes[0].overview,'English summary.');assert.equal(guide.episodes[0].runtime,24);assert.match(guide.episodes[0].image,/image\.tmdb\.org/);
  });
});
test('TMDB : recherche paginée, dédoublonnage et paramètres arbitraires refusés',async()=>{
  await serve(client(),async base=>{
    const response=await fetch(base+'/api/tmdb/search?query=Interstellar&category=Film&page=2');const page=await response.json();assert.equal(page.page,2);assert.equal(page.totalPages,2);assert.equal(page.items.length,2);
    for(const suffix of ['search?query=x','search?query=ok&page=501','search?query=ok&url=https://evil.invalid','browse?category=Inconnue','browse?section=secret','detail/movie/0','detail/movie/157336?api_key=bad','status?x=1','search?query=ok&page=1&page=2'])assert.ok([400,404].includes((await fetch(base+'/api/tmdb/'+suffix)).status),suffix);
    assert.equal((await fetch(base+'/api/tmdb/search',{method:'POST'})).status,405);
    const recent=await(await fetch(base+'/api/tmdb/browse?section=recent&category=Film')).json();assert.ok(recent.items.length);
  });
});
test('TMDB : cache, appels simultanés fusionnés, expiration et secours périmé signalé',async()=>{
  let time=1000,calls=0,failed=false;
  const api=client({now:()=>time,maxEntries:2,fetchImpl:async()=>{calls++;if(failed)throw new Error('secret '+SENTINEL);return Response.json(movie);}});
  const result=await Promise.all(Array.from({length:8},()=>api.get('/movie/157336',{},100)));assert.equal(calls,1);assert.equal(result[0].stale,false);
  await api.get('/movie/157336',{},100);assert.equal(calls,1);time+=101;failed=true;assert.equal((await api.get('/movie/157336',{},100)).stale,true);
  time+=86400200;await assert.rejects(api.get('/movie/157336',{},100),error=>error.code==='TMDB_UNAVAILABLE'&&!error.message.includes(SENTINEL));
});
test('TMDB : concurrence bornée à quatre et respect de Retry-After',async()=>{
  let active=0,maximum=0;
  const api=client({fetchImpl:async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json(movie);}});
  await Promise.all(Array.from({length:12},(_,i)=>api.get('/movie/'+(i+1))));assert.equal(maximum,4);
  let calls=0;const limited=client({fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});}});
  await assert.rejects(limited.get('/movie/1'),error=>error.status===429&&error.retryAfter===60);
  await assert.rejects(limited.get('/movie/2'),error=>error.status===429);assert.equal(calls,1);
});
test('TMDB : erreurs amont et JSON incorrect ne divulguent jamais le secret',async()=>{
  for(const fetchImpl of [async()=>{throw new Error(SENTINEL);},async()=>new Response(SENTINEL,{status:401}),async()=>new Response('{bad json '+SENTINEL)]){
    await serve(client({fetchImpl}),async base=>{const response=await fetch(base+'/api/tmdb/detail/movie/157336');assert.equal(response.status,502);assert.ok(!(await response.text()).includes(SENTINEL));});
  }
});
test('TMDB : anciens identifiants conservés et correspondance exacte uniquement',async()=>{
  await serve(client(),async base=>{
    const mapping=await(await fetch(base+'/api/tmdb/resolve?id=movie-tt0816692')).json();assert.deepEqual(mapping,{mediaType:'movie',tmdbId:157336});
    const series=await(await fetch(base+'/api/tmdb/resolve?id=series-2993')).json();assert.equal(series.mediaType,'tv');assert.equal(series.tmdbId,66732);
    assert.equal((await fetch(base+'/api/tmdb/resolve?id=series-999999999')).status,404);
  });
});
test('TMDB : modèle sans véritable clé et module client sans authentification TMDB',()=>{
  const root=path.join(__dirname,'..');
  assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/\.env/);
  assert.match(fs.readFileSync(path.join(root,'.env.example'),'utf8'),/^TMDB_API_KEY=$/m);
  const browser=fs.readFileSync(path.join(root,'tmdb-client.js'),'utf8');assert.ok(!browser.includes('TMDB_API_KEY'));assert.ok(!browser.includes('api.themoviedb.org'));assert.ok(!browser.includes('api_key='));
});
