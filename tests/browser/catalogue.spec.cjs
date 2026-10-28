const {test,expect}=require('@playwright/test');const {once}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {createMovixServer}=require('../../server.cjs');const {createTMDBClient}=require('../../server/tmdb-client.cjs');const {ADMIN_UID}=require('../../server/policy.cjs');const {createTestFirestore}=require('../fixtures/catalogue-db.cjs');const {movie,tv}=require('../fixtures/tmdb.cjs');
let server,base,db,revoked=false;
const evil={...movie,id:1576,title:'Resident Evil',original_title:'Resident Evil',release_date:'2002-03-15',imdb_id:'tt0120804'};
const auth={verifySessionCookie:async(value,check)=>{if(value!=='catalogue-test-session'||!check||revoked)throw new Error('Invalid session');return {uid:ADMIN_UID,admin:true};},getUser:async()=>({disabled:false,customClaims:{admin:true}})};
test.beforeEach(async()=>{
 const client=createTMDBClient({apiKey:()=> '0'.repeat(32),fetchImpl:async url=>{const endpoint=url.pathname.slice(2);if(endpoint==='/movie/1576')return Response.json(evil);if(endpoint==='/tv/66732')return Response.json(tv);if(endpoint.includes('/genre/'))return Response.json({genres:[]});if(endpoint.includes('/search/'))return Response.json({page:1,total_pages:1,results:endpoint.includes('/movie')?[evil]:[tv]});if(endpoint.includes('/season/'))return Response.json({episodes:[1,2].map(number=>({id:500+number,episode_number:number,name:'Épisode de test '+number,overview:'Résumé de test.',runtime:24,air_date:'2020-01-01'}))});return new Response('{}',{status:404});}});
 server=createMovixServer({getAuth:()=>auth,getFirestore:async()=>db,tmdbClient:client});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
 // L'origine CSRF doit correspondre au port de test ; même serveur, nouvelle origine explicite.
 await new Promise(resolve=>server.close(resolve));server=createMovixServer({getAuth:()=>auth,getFirestore:async()=>db,tmdbClient:client,origin:base});server.listen(Number(new URL(base).port),'127.0.0.1');await once(server,'listening');
});
test.afterEach(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(async({context,page})=>{db=createTestFirestore();revoked=false;await context.addCookies([{name:'movix_admin',value:'catalogue-test-session',url:base,httpOnly:true,sameSite:'Strict'}]);await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());await page.route('https://image.tmdb.org/**',route=>route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(path.join(__dirname,'../../assets/discovery/movie-tt0816692.jpg'))}));page.on('dialog',dialog=>{if(dialog.type()==='confirm')void dialog.accept();else if(dialog.type()==='prompt')void dialog.accept('tmdb-movie-1576');});});
async function admin(page){await page.goto(base+'/admin');await expect(page.locator('#catalogue-service-state')).toContainText('connexion disponible');}
async function confirmAddition(page){await expect(page.locator('#admin-add-dialog')).toBeVisible();await page.locator('#admin-add-confirm').click();await expect(page.locator('#admin-content-editor')).toBeVisible();}
async function addMovie(page){await admin(page);await page.locator('#admin-tmdb-form button[type=submit]').click();await expect(page.locator('#admin-tmdb-results')).toContainText('Resident Evil');await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();await confirmAddition(page);await expect(page.locator('#admin-editor-state')).toContainText('Brouillon');}
test('admin : Resident Evil 2002, brouillon, corrections, publication et masquage effectifs',async({page,context})=>{
 await addMovie(page);await expect(page.locator('#admin-tmdb-results')).toContainText('2002');
 const publicPage=await context.newPage();await publicPage.goto(base+'/titre.html?id=tmdb-movie-1576');await expect(publicPage.locator('#title-content')).toBeHidden();
 await page.locator('#admin-editor-title').fill('Resident Evil — ma sélection');await page.locator('#admin-editor-form button[type=submit]').click();await expect(page.locator('#admin-editor-heading')).toHaveText('Resident Evil — ma sélection');
 await page.locator('[data-catalogue-action="published"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Publié');
 await publicPage.reload();await expect(publicPage.locator('#title-name')).toHaveText('Resident Evil — ma sélection');
 await page.locator('[data-catalogue-action="refresh"]').click();await expect(page.locator('#admin-editor-heading')).toHaveText('Resident Evil — ma sélection');await expect(page.locator('#admin-editor-state')).toContainText('Publié');
 await page.locator('[data-catalogue-action="hidden"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Masqué');
 await publicPage.reload();await expect(publicPage.locator('#title-content')).toBeHidden();await publicPage.close();
});
test('admin : saisons et épisodes publiés individuellement, sans vidéo fictive',async({page,context})=>{
 await admin(page);await page.locator('#admin-tmdb-query').fill('Stranger Things');await page.locator('#admin-tmdb-kind').selectOption('Série');await page.locator('#admin-tmdb-year').fill('');await page.locator('#admin-tmdb-form button').click();await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();
 await confirmAddition(page);
 await page.locator('#admin-season-import').click();await expect(page.locator('#admin-season-list')).toContainText('Saison 1');await expect(page.locator('.admin-episode-row')).toHaveCount(2);
 const episode=page.locator('.admin-episode-row').first();await episode.locator('input[type=checkbox]').check();await episode.getByRole('button',{name:'Enregistrer cet épisode'}).click();await expect(page.locator('#admin-season-list')).toContainText('1 épisodes validés');
 await page.getByRole('button',{name:'Valider la saison',exact:true}).click();await expect(page.locator('#admin-season-list')).toContainText('Validée');
 await page.locator('[data-catalogue-action="published"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Publié');
 const viewer=await context.newPage();await viewer.goto(base+'/titre.html?id=tmdb-tv-66732');await expect(viewer.locator('#episode-select option')).toHaveCount(1);await expect(viewer.locator('video,iframe')).toHaveCount(0);await viewer.close();
});
test('admin : échec réseau sans faux succès et conflit de version sans écrasement',async({page})=>{
 await addMovie(page);await page.locator('#admin-editor-title').fill('Modification non enregistrée');
 await page.route('**/api/admin/catalogue/tmdb-movie-1576',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"CATALOGUE_FIRESTORE_UNAVAILABLE"}'}):route.continue());
 await page.locator('#admin-editor-form button[type=submit]').click();await expect(page.locator('#admin-content-editor .catalogue-feedback')).toContainText('Aucun enregistrement n’a été confirmé');await expect(page.locator('#admin-editor-title')).toHaveValue('Modification non enregistrée');
 await page.unroute('**/api/admin/catalogue/tmdb-movie-1576');const entry=db.data.get('catalogueEntries/tmdb-movie-1576');db.data.set('catalogueEntries/tmdb-movie-1576',{...entry,version:entry.version+1});
 await page.locator('#admin-editor-form button[type=submit]').click();await expect(page.locator('#admin-content-editor .catalogue-feedback')).toContainText('autre onglet');expect(db.data.get('catalogueEntries/tmdb-movie-1576').editor.title).toBe('');
});
test('admin : corbeille restaurable, suppression définitive confirmée et doublon refusé',async({page})=>{
 await addMovie(page);await page.locator('[data-catalogue-action="trash"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Corbeille');
 await page.locator('[data-catalogue-action="restore"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Brouillon');
 await page.locator('#admin-editor-close').click();await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();await confirmAddition(page);await expect(page.locator('#admin-content-editor .catalogue-feedback')).toContainText('existe déjà');expect([...db.data.keys()].filter(key=>/^catalogueEntries\/[^/]+$/.test(key)).length).toBe(1);
 await page.locator('[data-catalogue-action="trash"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Corbeille');await page.locator('[data-catalogue-action="purge"]').click();await expect(page.locator('#admin-content-editor')).toBeHidden();expect([...db.data.keys()].filter(key=>key.includes('1576'))).toHaveLength(0);
});
test('admin : mobile, navigation clavier, session révoquée et public sans contenus non validés',async({page})=>{
 await page.setViewportSize({width:390,height:844});await addMovie(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(page.locator('#admin-content-editor')).toBeHidden();
 revoked=true;const response=await page.request.get(base+'/api/admin/catalogue');expect(response.status()).toBe(401);
 await page.goto(base+'/');await expect(page.locator('#continue-cards .continue-card')).toHaveCount(0);await expect(page.locator('#catalogue-cards .media-card')).toHaveCount(0);
});
test('admin : capture de contrôle de l’interface sur une base de test isolée',async({page})=>{
 await admin(page);await page.locator('#admin-tmdb-form button').click();await expect(page.locator('#admin-tmdb-results')).toContainText('Resident Evil');
 const directory=path.join(__dirname,'../../output/catalogue-admin');fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'admin-test-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(directory,'admin-test-mobile.png'),fullPage:true});
});

test('admin : choix multiple des univers, édition et conservation après actualisation TMDB',async({page,context})=>{
 await admin(page);await page.locator('#admin-tmdb-form button').click();await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();
 await expect(page.locator('#admin-add-dialog')).toBeVisible();await expect(page.locator('#admin-add-platforms input')).toHaveCount(5);
 await page.locator('#admin-add-dialog').getByLabel('Netflix',{exact:true}).check();await page.locator('#admin-add-dialog').getByLabel('Prime Video',{exact:true}).check();await page.locator('#admin-add-dialog').getByLabel('Marvel',{exact:true}).check();
 expect(db.data.size).toBe(0);await confirmAddition(page);
 const root=page.locator('#admin-editor-platforms');await expect(root.getByLabel('Netflix',{exact:true})).toBeChecked();await expect(root.getByLabel('Prime Video',{exact:true})).toBeChecked();await expect(root.getByLabel('Disney+',{exact:true})).not.toBeChecked();
 await page.locator('[data-catalogue-action="published"]').click();await expect(page.locator('#admin-editor-state')).toContainText('Publié');
 const viewer=await context.newPage();for(const platform of ['netflix','prime-video','marvel']){await viewer.goto(base+'/'+platform+'.html');await expect(viewer.locator('#universe-catalogue')).toContainText('Resident Evil');}
 await viewer.goto(base+'/disney.html');await expect(viewer.locator('#universe-catalogue .discovery-card')).toHaveCount(0);
 await root.getByLabel('Netflix',{exact:true}).uncheck();await root.getByLabel('Prime Video',{exact:true}).uncheck();await root.getByLabel('Marvel',{exact:true}).uncheck();await root.getByLabel('Disney+',{exact:true}).check();
 await page.locator('#admin-editor-form button[type=submit]').click();await expect(page.locator('#admin-content-editor .catalogue-feedback')).toContainText('Modification enregistrée');
 await page.locator('[data-catalogue-action="refresh"]').click();await expect(root.getByLabel('Disney+',{exact:true})).toBeChecked();await expect(root.getByLabel('Netflix',{exact:true})).not.toBeChecked();
 await viewer.reload();await expect(viewer.locator('#universe-catalogue')).toContainText('Resident Evil');await viewer.goto(base+'/netflix.html');await expect(viewer.locator('#universe-catalogue .discovery-card')).toHaveCount(0);await viewer.close();
});

test('admin : annulation sans création, panne reprenable et choix des plateformes sur mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await admin(page);await page.locator('#admin-tmdb-form button').click();await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();
 await page.locator('#admin-add-dialog').getByLabel('Paramount+',{exact:true}).check();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const directory=path.join(__dirname,'../../output/catalogue-admin');fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'platform-choice-mobile.png')});
 await page.keyboard.press('Escape');await expect(page.locator('#admin-add-dialog')).toBeHidden();expect(db.data.size).toBe(0);
 await page.getByRole('button',{name:'Ajouter en brouillon',exact:true}).click();await expect(page.locator('#admin-add-dialog input:checked')).toHaveCount(0);await page.locator('#admin-add-dialog').getByLabel('Netflix',{exact:true}).check();
 await page.route('**/api/admin/catalogue',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"CATALOGUE_FIRESTORE_UNAVAILABLE"}'}):route.continue());
 await page.locator('#admin-add-confirm').click();await expect(page.locator('#admin-add-feedback')).toContainText('Aucun enregistrement');await expect(page.locator('#admin-add-dialog')).toBeVisible();await expect(page.locator('#admin-add-dialog').getByLabel('Netflix',{exact:true})).toBeChecked();expect(db.data.size).toBe(0);
 await page.unroute('**/api/admin/catalogue');await confirmAddition(page);await expect(page.locator('#admin-editor-platforms').getByLabel('Netflix',{exact:true})).toBeChecked();
});
