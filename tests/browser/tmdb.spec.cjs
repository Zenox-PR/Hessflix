// Parcours publics : seuls les documents explicitement publiés dans la base de test sont visibles.
const {test,expect}=require('@playwright/test');
const {once}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {createMovixServer}=require('../../server.cjs');
const {createCatalogueStore}=require('../../server/catalogue-store.cjs');
const {media,season}=require('../../server/tmdb-model.cjs');
const {movie,tv,anime,fakeTMDB}=require('../fixtures/tmdb.cjs');
const {createTestFirestore}=require('../fixtures/catalogue-db.cjs');
let server,base,db,store;
async function publish(raw,type,category,extra={}){
 const entry=await store.create(media(raw,type),category,'test-only',extra);
 if(type==='tv'){
   let state={entry};
   for(const number of [1,2]){
     const guide=season(fakeTMDB(new URL('https://api.themoviedb.org/3/tv/'+raw.id+'/season/'+number+'?language=fr-FR')),number);
     state=await store.importSeason(entry.id,state.entry.version,'test-only',number,guide);
     for(const episode of guide.episodes)state=await store.patchEpisode(entry.id,state.entry.version,'test-only',number,episode.number,{published:true});
     state=await store.patchSeason(entry.id,state.entry.version,'test-only',number,{published:true});
   }
 }
 const current=await store.get(entry.id);return store.patch(entry.id,current.entry.version,'test-only',{status:'published'});
}
test.beforeEach(async({page})=>{
 db=createTestFirestore();store=createCatalogueStore({getFirestore:async()=>db});
 await publish(movie,'movie','Film',{aliases:['movie-tt0816692']});await publish(tv,'tv','Série');await publish(anime,'tv','Anime');
 await store.create(media({...movie,id:999,title:'Interstellar secret'},'movie'),'Film','test-only');
 server=createMovixServer({catalogueStore:store});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
 await page.route('https://image.tmdb.org/**',route=>route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(path.join(__dirname,'../../assets/discovery/movie-tt0816692.jpg'))}));
});
test.afterEach(async()=>{await new Promise(resolve=>server.close(resolve));});
test('catalogue public : recherche limitée aux publications, ancienne URL et fiche enrichie',async({page})=>{
 await page.goto(base+'/');await page.locator('#search').fill('Interstellar');await page.locator('[data-filter="Film"]').click();await expect(page.locator('.tmdb-status')).toContainText('contenus validés');await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
 await page.locator('#catalogue-cards .card-open').click();await expect(page).toHaveURL(/id=movie-tt0816692/);await expect(page.locator('#title-name')).toHaveText('Interstellar');
 await expect(page.locator('#title-metadata')).toContainText('169 min');await expect(page.locator('#episode-section')).toBeHidden();await expect(page.locator('video,iframe')).toHaveCount(0);expect((await page.request.get(base+'/api/catalogue/tmdb-movie-999')).status()).toBe(404);
});
test('catalogue public : pagination dédoublonnée et favoris des contenus supplémentaires',async({page})=>{
 for(let index=0;index<55;index++)await publish({...movie,id:200000+index,title:'Interstellar test '+index,imdb_id:undefined},'movie','Film');
 await page.goto(base+'/');await page.locator('#search').fill('Interstellar');await page.locator('[data-filter="Film"]').click();await expect(page.locator('.tmdb-status')).toContainText('contenus validés');await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(50);
 await page.locator('#resultats .tmdb-more').click();await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(56);await page.locator('#catalogue-cards .favorite-button').last().click();await page.locator('[data-local-favorites]').click();await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
});
test('catalogue public : saisons à la demande, limites de navigation et choix persistant',async({page})=>{
 const calls=[];page.on('request',request=>{if(request.url().includes('/seasons/'))calls.push(request.url());});
 await page.goto(base+'/titre.html?id=tmdb-tv-66732');await expect(page.locator('#episode-selected')).toContainText('Saison 1, épisode 1');expect(calls.some(url=>url.endsWith('/2'))).toBe(false);
 await page.locator('#season-select').selectOption('2');await expect(page.locator('#episode-selected')).toContainText('Saison 2, épisode 1');await page.locator('#episode-next').click();await expect(page.locator('#episode-next')).toBeDisabled();
 await page.reload();await expect(page.locator('#episode-selected')).toContainText('Saison 2, épisode 2');await page.locator('#episode-prev').click();await page.locator('#episode-prev').click();await expect(page.locator('#episode-selected')).toContainText('Saison 1, épisode 2');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('catalogue public : anime, miniatures et panne de saison récupérable',async({page})=>{
 await page.route('**/api/catalogue/*/seasons/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"CATALOGUE_FIRESTORE_UNAVAILABLE"}'}));
 await page.goto(base+'/titre.html?id=tmdb-tv-1429');await expect(page.locator('#title-kind')).toHaveText('Anime · Série');await expect(page.locator('#episode-empty')).toContainText('temporairement indisponible');
 await page.unroute('**/api/catalogue/*/seasons/*');await page.getByRole('button',{name:'Réessayer le chargement des épisodes'}).click();await expect(page.locator('#episode-selected')).toContainText('Saison 1, épisode 1');await expect(page.locator('.tmdb-episode-card img').first()).toBeVisible();
});
test('catalogue public : panne recherche sans repli non validé et réponse obsolète ignorée',async({page})=>{
 await page.route('**/api/catalogue?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"CATALOGUE_FIRESTORE_UNAVAILABLE"}'}));
 await page.goto(base+'/');await page.locator('#search').fill('Interstellar');await expect(page.locator('.tmdb-status')).toContainText('Aucun contenu non validé');await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(0);
 await page.locator('#search').fill('');await expect(page.locator('#resultats')).toBeHidden();await page.unroute('**/api/catalogue?**');await page.locator('#search').fill('Interstellar');await expect(page.locator('.tmdb-status')).toContainText('contenus validés');await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(1);
});
test('catalogue public : aucune clé, accès TMDB privé et crédits présents',async({page})=>{
 const requests=[];page.on('request',request=>requests.push(request.url()));await page.goto(base+'/titre.html?id=tmdb-movie-157336');await expect(page.locator('#title-name')).toHaveText('Interstellar');
 expect(requests.some(url=>url.includes('api_key=')||url.includes('api.themoviedb.org'))).toBe(false);expect((await page.request.get(base+'/api/tmdb/detail/movie/157336')).status()).toBe(401);
 await page.locator('.tmdb-credits-link').click();await expect(page.locator('main')).toContainText('This product uses the TMDB API but is not endorsed or certified by TMDB.');await expect(page.locator('.tmdb-logo')).toHaveAttribute('src',/^https:\/\/www\.themoviedb\.org\/assets\/v4\/logos\//);
});
test('catalogue public : le masquage révoque la fiche malgré un ancien cache navigateur',async({page})=>{
 await page.goto(base+'/titre.html?id=movie-tt0816692');await expect(page.locator('#title-name')).toHaveText('Interstellar');await page.evaluate(()=>localStorage.setItem('hessflix-tmdb-cache-v1',JSON.stringify({title:'Interstellar'})));
 const entry=(await store.get('tmdb-movie-157336')).entry;await store.patch(entry.id,entry.version,'test-only',{status:'hidden'});await page.reload();await expect(page.locator('#title-content')).toBeHidden();
});
