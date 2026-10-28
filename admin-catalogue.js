// Panneau réel : chaque opération attend la confirmation de l'API protégée.
(() => {
  /** @typedef {import('./types/contracts').CatalogueItem} Item */
  /** @typedef {import('./types/contracts').PlatformId} PlatformId */
  /** @typedef {{category:string;title:string;overview:string;collection:string;rank:number;featured:boolean;platforms?:PlatformId[]}} Editor */
  /** @typedef {{id:string;tmdbId:number;mediaType:'movie'|'tv';status:string;version:number;meta:Item;editor:Editor;updatedAt:string;syncedAt:string;lock?:{nonce:string};video?:import('./types/contracts').VideoState}} Entry */
  /** @typedef {{number:number;published:boolean;complete:boolean;publishedEpisodes:number;importing?:boolean;importError?:boolean}} Season */
  /** @typedef {{number:number;meta:import('./types/contracts').Episode;published:boolean;editor:{title:string;overview:string};obsolete?:boolean;obsoleteAt?:string;obsoleteReason?:string;video?:import('./types/contracts').VideoState}} Episode */
  /** @template {Element} T @param {string} id @param {{new():T}} type @returns {T} */
  function get(id,type){const node=document.getElementById(id);if(!(node instanceof type))throw new Error('Élément manquant : '+id);return node;}
  /** @param {string} tag @param {string} cls @param {string} [text] */
  function make(tag,cls,text=''){const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;}
  /** @param {string} text @param {()=>void|Promise<void>} action */
  function button(text,action){const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',()=>{void run(action,node);});return node;}
  const dialog=get('admin-content-editor',HTMLDialogElement),feedback=get('catalogue-admin-feedback',HTMLElement);
  const addDialog=get('admin-add-dialog',HTMLDialogElement),addForm=get('admin-add-form',HTMLFormElement),addFeedback=get('admin-add-feedback',HTMLElement);
  const platformNames=/** @type {Record<PlatformId,string>} */({netflix:'Netflix','prime-video':'Prime Video',paramount:'Paramount+',disney:'Disney+',marvel:'Marvel'});
  /** @param {HTMLElement} root @param {PlatformId[]} selected */
  function platformOptions(root,selected){
    root.replaceChildren();
    for(const id of /** @type {PlatformId[]} */(Object.keys(platformNames))){
      const label=document.createElement('label'),input=document.createElement('input'),logo=document.createElement('img');
      input.type='checkbox';input.value=id;input.name='platforms';input.checked=selected.includes(id);
      logo.src='/assets/platforms/'+id+'.png';logo.alt='';logo.width=46;logo.height=32;
      label.append(input,logo,make('span','',platformNames[id]));root.append(label);
    }
  }
  /** @param {HTMLElement} root @returns {PlatformId[]} */
  function selectedPlatforms(root){return [...root.querySelectorAll('input:checked')].filter(node=>node instanceof HTMLInputElement).map(node=>/** @type {PlatformId} */(/** @type {HTMLInputElement} */(node).value));}
  const editorPlatforms=document.createElement('fieldset');editorPlatforms.className='admin-platform-fieldset wide';
  editorPlatforms.append(make('legend','','Plateformes et univers'),make('p','catalogue-hint','Choisissez où afficher ce contenu après publication. Vous pouvez sélectionner plusieurs univers ou aucun.'));
  const editorPlatformOptions=make('div','admin-platform-options');editorPlatformOptions.id='admin-editor-platforms';editorPlatforms.append(editorPlatformOptions);
  get('admin-editor-form',HTMLFormElement).querySelector('button[type="submit"]')?.before(editorPlatforms);
  const heroHint = make('p', 'catalogue-hint wide', '« Mettre en avant » et « Ordre de présentation » pilotent aussi la bannière. Sur une fiche déjà publiée, ces modifications sont immédiatement visibles après enregistrement. Pour préparer plusieurs changements et les prévisualiser avant publication, utilisez l’onglet « Bannière d’accueil ».');
  editorPlatforms.after(heroHint);
  /** @type {{item:Item;category:string;legacyId?:string}|null} */let pendingAdd=null;
  let adding=false;
  /** @param {Item} item @param {string} category @param {string} [legacyId] */
  function choosePlatforms(item,category,legacyId){
    pendingAdd={item,category,...(legacyId?{legacyId}:{})};
    get('admin-add-title',HTMLElement).textContent=item.title+' · '+(item.year||category);
    platformOptions(get('admin-add-platforms',HTMLElement),window.MovixModel.platformsFor(item));
    addFeedback.textContent='';addFeedback.classList.remove('is-error');addDialog.showModal();
    addDialog.querySelector('input')?.focus();
  }
  function cancelAdd(){if(!adding)addDialog.close();}
  get('admin-add-close',HTMLButtonElement).addEventListener('click',cancelAdd);get('admin-add-cancel',HTMLButtonElement).addEventListener('click',cancelAdd);
  addDialog.addEventListener('cancel',event=>{if(adding)event.preventDefault();});
  addDialog.addEventListener('close',()=>{pendingAdd=null;});
  addForm.addEventListener('submit',event=>{event.preventDefault();void submitAdd();});
  async function submitAdd(){
    if(adding||!pendingAdd)return;const pending=pendingAdd;adding=true;addDialog.setAttribute('aria-busy','true');
    const platforms=selectedPlatforms(get('admin-add-platforms',HTMLElement));
    const controls=addDialog.querySelectorAll('button,input');controls.forEach(control=>{if(control instanceof HTMLInputElement||control instanceof HTMLButtonElement)control.disabled=true;});
    addFeedback.textContent='Enregistrement du brouillon…';addFeedback.classList.remove('is-error');
    try{
      const result=/** @type {{entry:Entry}} */(await request('/api/admin/catalogue','POST',{mediaType:pending.item.mediaType,tmdbId:pending.item.tmdbId,category:pending.category,platforms,...(pending.legacyId?{legacyId:pending.legacyId}:{})}));
      addDialog.close();await open(result.entry.id);notify('Contenu enregistré en brouillon avec vos choix de plateformes.');
    }catch(error){
      if(error instanceof RequestError&&error.code==='CATALOGUE_DUPLICATE'){
        addDialog.close();await run(async()=>{await open('tmdb-'+pending.item.mediaType+'-'+pending.item.tmdbId);notify('Ce contenu existe déjà : sa fiche a été ouverte. Ses plateformes ont été conservées.');});
      }else {const message=error instanceof Error?error.message:'Ajout impossible. Réessayez.';addFeedback.textContent=message;addFeedback.classList.add('is-error');notify(message,true);}
    }finally{adding=false;addDialog.removeAttribute('aria-busy');controls.forEach(control=>{if(control instanceof HTMLInputElement||control instanceof HTMLButtonElement)control.disabled=false;});}
  }
  const localFeedback=make('p','catalogue-feedback');localFeedback.setAttribute('role','status');get('admin-editor-state',HTMLElement).after(localFeedback);
  const filmVideo = document.createElement('section'); filmVideo.id = 'admin-film-video'; filmVideo.hidden = true;
  get('admin-editor-form', HTMLFormElement).after(filmVideo);
  const names=/** @type {Record<string,string>} */({draft:'Brouillon',published:'Publié',hidden:'Masqué',deleted:'Corbeille',purging:'Suppression à terminer'});
  const messages=/** @type {Record<string,string>} */({CATALOGUE_FIRESTORE_UNAVAILABLE:'Firestore est indisponible. Vérifiez son activation, les permissions du serveur et les index. Aucun enregistrement n’a été confirmé.',CATALOGUE_DUPLICATE:'Ce contenu existe déjà dans votre catalogue.',CATALOGUE_CONFLICT:'Le contenu a changé dans un autre onglet. Rechargez sa fiche avant de recommencer.',CATALOGUE_IMPORT_BUSY:'Un import est en cours. Attendez ou utilisez « Annuler un import bloqué ».',CATALOGUE_IMPORT_INCOMPLETE:'Terminez l’import de cette saison avant de la publier.',CATALOGUE_NOT_PUBLISHED:'Ce contenu n’est pas publié.',TMDB_NOT_CONFIGURED:'La clé TMDB v3 est absente ou invalide. Renseignez TMDB_API_KEY dans .env puis redémarrez le serveur.',CATALOGUE_MATCH_UNCONFIRMED:'La correspondance avec l’ancienne fiche n’a pas pu être confirmée.',TMDB_MATCH_UNCERTAIN:'Correspondance TMDB ambiguë ou introuvable : aucun contenu n’a été importé.',CATALOGUE_TMDB_STALE:'TMDB est indisponible : les anciennes données en cache ne seront pas utilisées pour cet import.',ORIGIN_REJECTED:'Origine refusée. Ouvrez le site via l’adresse locale configurée, normalement http://localhost:4180.',CSRF_REJECTED:'Le contrôle de sécurité a expiré. Rechargez la page.',RATE_LIMITED:'Trop de demandes rapprochées. Patientez avant de réessayer.',CATALOGUE_RESTORE_REQUIRED:'Restaurez d’abord ce contenu en brouillon.',CATALOGUE_TRASH_FIRST:'Mettez d’abord le contenu à la corbeille.',CATALOGUE_CONFIRMATION_REQUIRED:'La confirmation de suppression ne correspond pas au contenu.'});
  class RequestError extends Error{
    /** @param {string} code */
    constructor(code){super(messages[code]||'Opération impossible ('+code+'). Vérifiez la configuration ou réessayez.');this.code=code;}
  }
  messages.CATALOGUE_NUMBERING_CHANGED='TMDB a modifié la numérotation de cette saison. Import arrêté : vos validations et corrections sont conservées. Vérifiez la correspondance des épisodes avant une migration manuelle.';
  messages.CATALOGUE_INVALID_PLATFORMS='Choisissez uniquement parmi les cinq plateformes proposées.';
  Object.assign(messages, {
    CATALOGUE_EPISODE_OBSOLETE: 'Cet épisode a disparu de la réponse TMDB. Ses informations sont conservées, mais sa publication est bloquée. Actualisez la saison pour vérifier son identité.',
    HERO_CONFLICT: 'La bannière a changé dans un autre onglet. Vos choix locaux sont conservés : rechargez la version du serveur avant de sauvegarder à nouveau.',
    HERO_PUBLISHED_ONLY: 'Un titre a été masqué, supprimé ou repassé en brouillon. Retirez-le de cette sélection avant de publier.',
    HERO_DUPLICATE: 'Ce titre figure déjà dans la bannière.',
    HERO_INVALID_IMAGE: 'Choisissez uniquement une image proposée pour ce titre.',
    HERO_INVALID_DRAFT: 'La sélection de la bannière est invalide ou dépasse 12 titres.',
    HERO_CONFIGURATION_TOO_LARGE: 'Trop d’anciens titres sont mis en avant. Réduisez leur nombre dans le catalogue avant de publier la bannière.'
  });
  /** @param {string} text @param {boolean} [error] */
  function notify(text,error=false){for(const node of [feedback,localFeedback]){node.textContent=text;node.classList.toggle('is-error',error);}}
  /** @param {()=>void|Promise<void>} action @param {HTMLButtonElement} [control] */
  async function run(action,control){if(control)control.disabled=true;try{await action();}catch(error){notify(error instanceof Error?error.message:'Erreur inattendue. Aucun succès n’a été confirmé.',true);}finally{if(control)control.disabled=false;}}
  /** @param {string} path @param {string} [method] @param {unknown} [body] @returns {Promise<unknown>} */
  async function request(path,method='GET',body){
    const headers=/** @type {Record<string,string>} */({});
    if(method!=='GET'){
      const response=await fetch('/api/admin/csrf',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new RequestError('CSRF_REJECTED');const token=await response.json();headers['X-CSRF-Token']=token.csrfToken;headers['Content-Type']='application/json';
    }
    const response=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(path.endsWith('/import')?120000:20000)});
    const data=await response.json().catch(()=>({error:'INVALID_RESPONSE'}));
    if(!response.ok){if(response.status===401)location.replace('/admin');throw new RequestError(data.error||data.code||'SERVICE_UNAVAILABLE');}return data;
  }
  /** @param {unknown} source */
  function image(source){return typeof source==='string'&&(/^assets\/discovery\/[a-z0-9-]+\.(jpg|png|webp)$/.test(source)||/^https:\/\/image\.tmdb\.org\/t\/p\/(w342|w500|w780|w1280)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(source))?source:'';}
  /** @param {string} title @param {string} poster @param {string} facts @param {string} overview */
  function card(title,poster,facts,overview){const article=make('article','admin-media-card');if(image(poster)){const img=document.createElement('img');img.src=image(poster);img.alt='';img.loading='lazy';img.decoding='async';img.addEventListener('error',()=>img.remove());article.append(img);}const copy=make('div','admin-media-copy');copy.append(make('h3','',title),make('p','',facts),make('p','summary',overview));article.append(copy);return {article,copy};}
  /** @type {Entry|null} */let current=null;
  /** @type {Season[]} */let imported=[];
  /** @type {number|null} */let activeSeason=null;
  let busy=false,searchPage=1,libraryCursor='',legacyCursor='',episodeRequest=0;
  const query=get('admin-tmdb-query',HTMLInputElement),kind=get('admin-tmdb-kind',HTMLSelectElement),year=get('admin-tmdb-year',HTMLInputElement);
  const searchMore=get('admin-tmdb-more',HTMLButtonElement),libraryMore=get('admin-library-more',HTMLButtonElement),legacyMore=get('admin-legacy-more',HTMLButtonElement);
  /** @param {string} name */
  function tab(name) {
    for (const value of ['search', 'library', 'legacy', 'hero']) get('admin-' + value + '-panel', HTMLElement).hidden = value !== name;
    document.querySelectorAll('[data-admin-tab]').forEach(node => node.setAttribute('aria-pressed', String(node.getAttribute('data-admin-tab') === name)));
    if (name === 'library') void run(() => library(false));
    if (name === 'legacy') void run(() => legacy(false));
    window.dispatchEvent(new CustomEvent('hessflix-admin-tab', { detail: name }));
  }
  document.querySelectorAll('[data-admin-tab]').forEach(node=>node.addEventListener('click',()=>tab(node.getAttribute('data-admin-tab')||'search')));
  /** @param {boolean} append */
  async function search(append){
    const form=get('admin-tmdb-form',HTMLFormElement);if(!form.reportValidity())return;
    const page=append?searchPage+1:1,params=new URLSearchParams({query:query.value.trim(),category:kind.value,page:String(page),...(year.value?{year:year.value}:{})});
    notify('Recherche TMDB en cours…');const result=/** @type {import('./types/contracts').TMDBPage} */(await request('/api/admin/tmdb/search?'+params));
    const root=get('admin-tmdb-results',HTMLElement);if(!append)root.replaceChildren();
    for(const item of result.items.filter(item=>!year.value||item.year===year.value)){
      const {article,copy}=card(item.title,item.image||'',(item.isAnime?'Anime':item.kind)+' · '+(item.releaseDate||item.year||'Date non renseignée')+' · TMDB '+item.tmdbId,item.overview||'Synopsis non renseigné.');
      copy.append(button('Ajouter en brouillon',()=>choosePlatforms(item,kind.value==='Anime'?'Anime':item.isAnime?'Anime':item.kind==='Film'?'Film':'Série')));root.append(article);
    }
    searchPage=result.page;searchMore.hidden=searchPage>=result.totalPages;
    notify('Page '+result.page+' / '+result.totalPages+' · Les résultats affichés respectent le filtre d’année.');
  }
  get('admin-tmdb-form',HTMLFormElement).addEventListener('submit',event=>{event.preventDefault();void run(()=>search(false));});searchMore.addEventListener('click',()=>{void run(()=>search(true),searchMore);});kind.addEventListener('change',()=>{if(kind.value!=='Film')year.value='';});
  /** @param {boolean} append */
  async function library(append){
    const params=new URLSearchParams({query:get('admin-library-query',HTMLInputElement).value,status:get('admin-library-status',HTMLSelectElement).value,...(append&&libraryCursor?{cursor:libraryCursor}:{})});
    const result=/** @type {{entries:Entry[];nextCursor:string|null}} */(await request('/api/admin/catalogue?'+params)),root=get('admin-library-results',HTMLElement);if(!append)root.replaceChildren();
    for(const entry of result.entries){const {article,copy}=card(entry.editor.title||entry.meta.title,entry.meta.image||'',(names[entry.status]||entry.status)+' · '+entry.editor.category+' · '+entry.meta.year,entry.editor.overview||entry.meta.overview||'');const platforms=entry.editor.platforms??window.MovixModel.platformsFor(entry.meta);copy.append(make('p','admin-platform-summary',platforms.length?platforms.map(id=>platformNames[id]).join(' · '):'Catalogue général uniquement'),button('Gérer ce contenu',()=>open(entry.id)));root.append(article);}
    libraryCursor=result.nextCursor||'';libraryMore.hidden=!libraryCursor;
  }
  get('admin-library-form',HTMLFormElement).addEventListener('submit',event=>{event.preventDefault();void run(()=>library(false));});libraryMore.addEventListener('click',()=>{void run(()=>library(true),libraryMore);});
  /** @param {boolean} append */
  async function legacy(append){
    const result=/** @type {{entries:{id:string;title:string;year:string;kind:string;image:string}[];nextCursor:string|null}} */(await request('/api/admin/catalogue/legacy?'+new URLSearchParams({cursor:append?legacyCursor:'0'}))),root=get('admin-legacy-results',HTMLElement);if(!append)root.replaceChildren();
    for(const item of result.entries){const {article,copy}=card(item.title,item.image,item.kind+' · '+item.year,'Ancienne sélection locale. Correspondance à vérifier avant import.');
      copy.append(button('Vérifier la correspondance TMDB',async()=>{
        const resolved=/** @type {{mediaType:'movie'|'tv';tmdbId:number}} */(await request('/api/admin/tmdb/resolve?id='+encodeURIComponent(item.id)));
        const detail=/** @type {{item:Item}} */(await request('/api/admin/tmdb/detail/'+resolved.mediaType+'/'+resolved.tmdbId));
        copy.append(make('p','', 'Correspondance : '+detail.item.title+' ('+detail.item.year+') · '+resolved.mediaType+' / '+resolved.tmdbId));
        copy.append(button('Confirmer l’import en brouillon',()=>choosePlatforms(detail.item,detail.item.isAnime?'Anime':resolved.mediaType==='movie'?'Film':'Série',item.id)));
      }));root.append(article);
    }legacyCursor=result.nextCursor||'';legacyMore.hidden=!legacyCursor;
  }
  legacyMore.addEventListener('click',()=>{void run(()=>legacy(true),legacyMore);});
  /** @param {string} id */
  async function open(id){
    const result=/** @type {{entry:Entry;seasons:Season[]}} */(await request('/api/admin/catalogue/'+id));if(!result.entry?.id)throw new Error('Fiche administrateur invalide.');current=result.entry;imported=result.seasons;const entry=current;
    window.HessflixAdminVideo?.clear();
    episodeRequest++;
    const videoRoot = get('admin-film-video', HTMLElement);
    videoRoot.replaceChildren(); videoRoot.hidden = entry.mediaType !== 'movie' || ['deleted','purging'].includes(entry.status);
    if (!videoRoot.hidden) videoEditor(videoRoot, entry.id, '', entry.video);
    get('admin-editor-heading',HTMLElement).textContent=entry.editor.title||entry.meta.title;
    get('admin-editor-state',HTMLElement).textContent=(names[entry.status]||entry.status)+' · Version '+entry.version+' · Métadonnées actualisées le '+new Date(entry.syncedAt).toLocaleString('fr-FR')+(entry.lock?' · Import en cours':'');
    get('admin-editor-title',HTMLInputElement).value=entry.editor.title;get('admin-editor-title',HTMLInputElement).placeholder=entry.meta.title;
    get('admin-editor-overview',HTMLTextAreaElement).value=entry.editor.overview;get('admin-editor-overview',HTMLTextAreaElement).placeholder=entry.meta.overview||'';
    const category=get('admin-editor-category',HTMLSelectElement);category.value=entry.editor.category;for(const option of category.options)option.disabled=(option.value==='Film'&&entry.mediaType!=='movie')||(option.value==='Série'&&entry.mediaType!=='tv');
    get('admin-editor-collection',HTMLInputElement).value=entry.editor.collection||'';get('admin-editor-rank',HTMLInputElement).value=String(entry.editor.rank||0);get('admin-editor-featured',HTMLInputElement).checked=entry.editor.featured;
    platformOptions(editorPlatformOptions,entry.editor.platforms??window.MovixModel.platformsFor(entry.meta));
    document.querySelectorAll('[data-catalogue-action]').forEach(control=>{if(!(control instanceof HTMLButtonElement))return;const action=control.dataset.catalogueAction||'';control.hidden=(['restore','purge'].includes(action)?!['deleted','purging'].includes(entry.status):['deleted','purging'].includes(entry.status))||(action==='recover'&&!entry.lock);});
    get('admin-editor-form',HTMLFormElement).hidden=['deleted','purging'].includes(entry.status);
    const panel=get('admin-seasons-panel',HTMLElement);panel.hidden=entry.mediaType!=='tv'||['deleted','purging'].includes(entry.status);
    const seasonSelect=get('admin-season-import-number',HTMLSelectElement);seasonSelect.replaceChildren();for(const season of entry.meta.tmdbSeasons||[]){const option=document.createElement('option');option.value=String(season.number);option.textContent=season.number===0?'Épisodes spéciaux':'Saison '+season.number;seasonSelect.append(option);}
    get('admin-season-import',HTMLButtonElement).disabled=!seasonSelect.options.length||!!entry.lock;
    seasonRows();if(!dialog.open)dialog.showModal();if(activeSeason!==null&&imported.some(season=>season.number===activeSeason))await episodes(activeSeason);else get('admin-episode-list',HTMLElement).replaceChildren();
  }
  /** @param {string} path @param {string} method @param {Record<string,unknown>} body */
  async function mutate(path,method,body){if(!current||busy)return;const entry=current;busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button').forEach(control=>control.disabled=true);
    try{await request('/api/admin/catalogue/'+entry.id+path,method,{version:entry.version,...body});if(method==='DELETE'){current=null;dialog.close();await library(false);notify('Contenu supprimé définitivement.');}else{await open(entry.id);notify('Modification enregistrée par le serveur.');}window.dispatchEvent(new CustomEvent('hessflix-admin-catalogue-changed',{detail:{id:entry.id,entry:current}}));}
    finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button').forEach(control=>control.disabled=false);get('admin-season-import',HTMLButtonElement).disabled=!get('admin-season-import-number',HTMLSelectElement).options.length||!!current?.lock;}
  }
  get('admin-editor-form',HTMLFormElement).addEventListener('submit',event=>{event.preventDefault();void run(()=>mutate('','PATCH',{editor:{title:get('admin-editor-title',HTMLInputElement).value,overview:get('admin-editor-overview',HTMLTextAreaElement).value,category:get('admin-editor-category',HTMLSelectElement).value,collection:get('admin-editor-collection',HTMLInputElement).value,rank:Number(get('admin-editor-rank',HTMLInputElement).value),featured:get('admin-editor-featured',HTMLInputElement).checked,platforms:selectedPlatforms(editorPlatformOptions)}}));});
  document.querySelectorAll('[data-catalogue-action]').forEach(control=>control.addEventListener('click',()=>{void run(async()=>{
    if(!current)return;const action=control.getAttribute('data-catalogue-action')||'';
    if(action==='purge'){const confirmation=window.prompt('Suppression définitive, y compris les saisons et épisodes. Pour confirmer, recopiez cet identifiant : '+current.id);if(confirmation!==current.id)return;await mutate('','DELETE',{confirmation});}
    else if(['trash','restore','refresh','recover'].includes(action)){if(action==='trash'&&!window.confirm('Retirer ce contenu du public et le placer dans la corbeille restaurable ?'))return;await mutate('/'+action,'POST',{});}
    else {if(action==='published'&&!window.confirm('Publier cette fiche et uniquement les saisons / épisodes que vous avez validés ?'))return;await mutate('','PATCH',{status:action});}
  });}));
  get('admin-editor-close',HTMLButtonElement).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{activeSeason=null;episodeRequest++;});
  get('admin-season-import',HTMLButtonElement).addEventListener('click',()=>{void run(async()=>{const number=Number(get('admin-season-import-number',HTMLSelectElement).value);activeSeason=number;notify('Import des métadonnées en cours. Les nouveaux épisodes resteront non publiés.');await mutate('/seasons/'+number+'/import','POST',{});});});
  function seasonRows(){const root=get('admin-season-list',HTMLElement);root.replaceChildren();for(const season of imported){const row=make('div','admin-season-row');row.append(make('strong','',(season.number===0?'Spéciaux':'Saison '+season.number)+' · '+(season.published?'Validée':'Non publiée')+' · '+season.publishedEpisodes+' épisodes validés'+(season.importError?' · Import à reprendre':'')));
    row.append(button('Gérer les épisodes',()=>episodes(season.number)),button(season.published?'Masquer la saison':'Valider la saison',()=>mutate('/seasons/'+season.number,'PATCH',{published:!season.published})));root.append(row);}}
  /** @param {HTMLElement} root @param {string} id @param {string} suffix @param {import('./types/contracts').VideoState|undefined} state */
  function videoEditor(root, id, suffix, state) {
    window.HessflixAdminVideo?.mount(root, {
      path: '/api/admin/catalogue/' + id + suffix + '/video', state,
      version: () => { if (current?.id !== id) throw new Error('La fiche active a changé. Rouvrez ce contenu.'); return current.version; },
      changed: async () => { if (current?.id !== id) return; await open(id); notify('Association vidéo enregistrée. Seule la version validée est accessible avec un contenu publié.'); }
    });
  }
  /** @param {number} number */
  async function episodes(number){if(!current)return;const id=current.id,ticket=++episodeRequest;const result=/** @type {{season:Season;episodes:Episode[]}} */(await request('/api/admin/catalogue/'+id+'/seasons/'+number));if(ticket!==episodeRequest||current?.id!==id)return;window.HessflixAdminVideo?.clear();activeSeason=number;const root=get('admin-episode-list',HTMLElement);root.replaceChildren(make('h3','',number===0?'Épisodes spéciaux':'Épisodes de la saison '+number));
    for(const episode of result.episodes){const form=document.createElement('form');form.className='admin-episode-row';form.append(make('h4','',episode.number+'. '+(episode.meta.title||'Titre non renseigné')),make('small','',[episode.meta.airdate,episode.meta.runtime?episode.meta.runtime+' min':''].filter(Boolean).join(' · ')));
      const published=document.createElement('input');published.type='checkbox';published.checked=episode.published;const publishedLabel=make('label','admin-checkbox','Épisode validé pour publication');publishedLabel.prepend(published);
      if (episode.obsolete) {
        form.classList.add('is-obsolete');
        const warning = make('p', 'admin-episode-obsolete', 'Épisode obsolète : absent du dernier guide TMDB. Ses informations et corrections sont conservées. ' + (episode.published ? 'Il reste visible tant que vous ne le masquez pas ; il ne pourra ensuite plus être republié sans confirmation de son identité par TMDB.' : 'Sa publication est bloquée jusqu’au retour du même identifiant TMDB.'));
        warning.setAttribute('role', 'note');
        form.append(warning);
        published.disabled = !episode.published;
      }
      const title=document.createElement('input');title.maxLength=500;title.value=episode.editor.title;title.placeholder=episode.meta.title;const titleLabel=make('label','','Titre personnalisé (facultatif)');titleLabel.append(title);
      const overview=document.createElement('textarea');overview.maxLength=12000;overview.value=episode.editor.overview;overview.placeholder=episode.meta.overview||'Synopsis non renseigné';const overviewLabel=make('label','','Synopsis personnalisé (facultatif)');overviewLabel.append(overview);
      const save=document.createElement('button');save.type='submit';save.textContent='Enregistrer cet épisode';form.append(publishedLabel,titleLabel,overviewLabel,save);
      form.addEventListener('submit',event=>{event.preventDefault();void run(()=>mutate('/seasons/'+number+'/episodes/'+episode.number,'PATCH',{published:published.checked,editor:{title:title.value,overview:overview.value}}));});root.append(form);
      const video = make('div', 'admin-episode-video'); video.dataset.videoEpisode = String(episode.number); root.append(video);
      videoEditor(video, current.id, '/seasons/' + number + '/episodes/' + episode.number, episode.video);
    }
  }
  window.HessflixAdminCatalogue = { request, tab, notify };
  void run(async()=>{const state=/** @type {{tmdb:boolean;firestore:boolean}} */(await request('/api/admin/catalogue/status'));get('catalogue-service-state',HTMLElement).textContent='TMDB : '+(state.tmdb?'clé configurée':'à configurer')+' · Firestore : '+(state.firestore?'connexion disponible':'indisponible / activation ou permissions à vérifier')+'. Aucune configuration cloud n’a été modifiée.';});
})();
