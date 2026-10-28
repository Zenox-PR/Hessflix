const {HttpError}=require('./policy.cjs');
const {createRateLimiter}=require('./rate-limit.cjs');
const {legacyCatalogue,legacyCollections}=require('./tmdb-routes.cjs');
const model=require('./catalogue-model.cjs');
const { sendPublicText } = require('./public-response.cjs');
const { videoSource } = require('./vidmoly.cjs');
function createCatalogueRoutes({admin,store,tmdb,root,hero}){
  const limit=createRateLimiter();let legacy;
  const legacyItems=()=>{legacy ||= legacyCatalogue(root);return legacy;};
  const error=(response,exception)=>{const status=exception instanceof HttpError?exception.status:503;admin.json(response,status,{error:exception instanceof HttpError?exception.code:'CATALOGUE_FIRESTORE_UNAVAILABLE'},exception.retryAfter?{'Retry-After':String(exception.retryAfter)}:{});};
  function params(url,keys){for(const key of url.searchParams.keys())if(!keys.includes(key)||url.searchParams.getAll(key).length!==1)throw new HttpError(400,'CATALOGUE_INVALID_QUERY');}
  function aliases(item){const entries=[...legacyItems().values()];return entries.filter(entry=>entry.id==='movie-'+item.imdbId||entry.imageSource===`https://www.themoviedb.org/${item.mediaType}/${item.tmdbId}`).map(entry=>entry.id);}
  async function handleAdmin(request,response,url){try{
    limit(request,'catalogue-admin',100,400);const identity=await admin.requireSession(request);
    const suffix=url.pathname.slice('/api/admin/catalogue'.length);
    if(request.method==='GET'){
      if (suffix === '/hero') { params(url, []); admin.json(response, 200, await hero.read()); return; }
      const galleryMatch = /^\/(tmdb-(?:movie|tv)-[1-9]\d{0,8})\/hero-images$/.exec(suffix);
      if (galleryMatch) { params(url, []); admin.json(response, 200, await hero.gallery(galleryMatch[1])); return; }
      if(suffix==='/status'){params(url,[]);let firestore=false;try{await store.health();firestore=true;}catch{}admin.json(response,200,{firestore,tmdb:tmdb.configured()});return;}
      if(suffix==='/legacy'){params(url,['cursor']);const start=model.integer(Number(url.searchParams.get('cursor')||0),100000);const entries=[...legacyItems().values()].slice(start,start+30).map(item=>({id:item.id,title:item.title,year:item.year,kind:item.kind,image:item.image||''}));admin.json(response,200,{entries,nextCursor:start+30<legacyItems().size?String(start+30):null});return;}
      if(!suffix){params(url,['query','status','cursor']);const status=url.searchParams.get('status')||'';if(status&&!['draft','published','hidden','deleted','purging'].includes(status))throw new HttpError(400,'CATALOGUE_INVALID_STATUS');admin.json(response,200,await store.list({query:model.string(url.searchParams.get('query')||'',150),status,after:url.searchParams.get('cursor')||''}));return;}
      const match=/^\/(tmdb-(?:movie|tv)-[1-9]\d{0,8})(?:\/seasons\/(\d{1,4}))?$/.exec(suffix);if(!match)throw new HttpError(404,'CATALOGUE_NOT_FOUND');params(url,[]);
      admin.json(response,200,match[2]!==undefined?await store.season(match[1],Number(match[2])):await store.get(match[1]));return;
    }
    admin.sameOrigin(request);admin.checkCsrf(request);params(url,[]);const body=await admin.body(request,32768);
    if (suffix === '/video-preview' && request.method === 'POST') {
      model.object(body, ['url', 'rightsConfirmed']);
      const source = videoSource(body.url, body.rightsConfirmed);
      admin.json(response, 200, { embedURL: source.embedURL }); return;
    }
    const videoMatch = /^\/(tmdb-(?:movie|tv)-[1-9]\d{0,8})(?:\/seasons\/(\d{1,4})\/episodes\/([1-9]\d{0,4}))?\/video(\/publish)?$/.exec(suffix);
    if (videoMatch) {
      const action = request.method === 'PUT' && !videoMatch[4] ? 'save' : request.method === 'DELETE' && !videoMatch[4] ? 'remove' : request.method === 'POST' && videoMatch[4] ? 'publish' : '';
      if (!action) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      model.object(body, action === 'save' ? ['version', 'url', 'rightsConfirmed'] : ['version']);
      const target = videoMatch[2] !== undefined ? { season: Number(videoMatch[2]), episode: Number(videoMatch[3]) } : null;
      admin.json(response, 200, await store.changeVideo(videoMatch[1], model.version(body.version), identity.uid, target, action, body)); return;
    }
    if (suffix === '/hero' && request.method === 'PUT') {
      model.object(body, ['version', 'slots']); admin.json(response, 200, await hero.save(body.version, body.slots, identity.uid)); return;
    }
    if (suffix === '/hero/publish' && request.method === 'POST') {
      model.object(body, ['version']); admin.json(response, 200, await hero.publish(body.version, identity.uid)); return;
    }
    if(!suffix&&request.method==='POST'){
      model.object(body,['mediaType','tmdbId','category','legacyId','platforms']);const id=model.canonical(body.mediaType,body.tmdbId);void id;
      const platforms=body.platforms===undefined?undefined:model.platforms(body.platforms);
      const result=await tmdb.details(body.mediaType,body.tmdbId);if(result.stale)throw new HttpError(503,'CATALOGUE_TMDB_STALE');
      const alias=aliases(result.item);let extra={aliases:alias};
      if(body.legacyId!==undefined){if(typeof body.legacyId!=='string'||!legacyItems().has(body.legacyId))throw new HttpError(400,'CATALOGUE_INVALID_ID');const resolved=await tmdb.resolve(body.legacyId);if(resolved.mediaType!==body.mediaType||resolved.tmdbId!==body.tmdbId)throw new HttpError(409,'CATALOGUE_MATCH_UNCONFIRMED');extra={aliases:[...new Set([body.legacyId,...alias])],collection:legacyItems().get(body.legacyId).collection||''};}
      const previous=extra.aliases.map(value=>legacyItems().get(value)).find(Boolean);
      if(platforms!==undefined)extra.platforms=platforms;
      if(previous){result.item.availability=previous.availability||[];result.item.marvel=previous.marvel===true;if(!extra.collection)extra.collection=previous.collection||'';}
      const category=model.category(body.category|| (result.item.isAnime?'Anime':body.mediaType==='movie'?'Film':'Série'),body.mediaType);
      admin.json(response,201,{entry:await store.create(result.item,category,identity.uid,extra),seasons:[]});return;
    }
    const match=/^\/(tmdb-(movie|tv)-([1-9]\d{0,8}))(?:\/(refresh|trash|restore|recover|seasons\/(\d{1,4})(?:\/(import|episodes\/(\d{1,5})))?))?$/.exec(suffix);
    if(!match)throw new HttpError(404,'CATALOGUE_NOT_FOUND');const id=match[1],version=model.version(body?.version),operation=match[4]||'';let result;
    if(!operation&&request.method==='PATCH'){
      model.object(body,['version','editor','status']);if(body.status!==undefined&&!['draft','published','hidden'].includes(body.status))throw new HttpError(400,'CATALOGUE_INVALID_STATUS');result=await store.patch(id,version,identity.uid,body);
    }else if(!operation&&request.method==='DELETE'){
      model.object(body,['version','confirmation']);if(body.confirmation!==id)throw new HttpError(400,'CATALOGUE_CONFIRMATION_REQUIRED');result=await store.purge(id,version,identity.uid);
    }else if(request.method==='POST'&&['trash','restore','recover','refresh'].includes(operation)){
      model.object(body,['version']);
      if(operation==='refresh'){const fresh=await tmdb.details(match[2],Number(match[3]),true);if(fresh.stale)throw new HttpError(503,'CATALOGUE_TMDB_STALE');result=await store.refresh(id,version,identity.uid,fresh.item);}
      else if(operation==='recover')result=await store.recover(id,version,identity.uid);
      else {const current=await store.get(id);if(operation==='restore'&&current.entry.status!=='deleted')throw new HttpError(409,'CATALOGUE_TRASH_FIRST');result=await store.state(id,version,identity.uid,operation==='trash'?'deleted':'draft');}
    }else if(match[5]!==undefined){
      const number=Number(match[5]);
      if(match[6]==='import'&&request.method==='POST'){model.object(body,['version']);const current=await store.get(id);if(current.entry.version!==version)throw new HttpError(409,'CATALOGUE_CONFLICT');const guide=await tmdb.seasonDetails(Number(match[3]),number,true);if(guide.stale)throw new HttpError(503,'CATALOGUE_TMDB_STALE');result=await store.importSeason(id,version,identity.uid,number,guide);}
      else if(match[7]&&request.method==='PATCH'){
        model.object(body,['version','published','editor']);const patch={};if('published'in body){if(typeof body.published!=='boolean')throw new HttpError(400,'CATALOGUE_INVALID_FIELDS');patch.published=body.published;}
        if(body.editor){model.object(body.editor,['title','overview']);patch.editor={};for(const key of Object.keys(body.editor))patch.editor[key]=model.string(body.editor[key],key==='title'?500:12000);}
        result=await store.patchEpisode(id,version,identity.uid,number,Number(match[7]),patch);
      }else if(!match[6]&&request.method==='PATCH'){
        model.object(body,['version','published']);if(typeof body.published!=='boolean')throw new HttpError(400,'CATALOGUE_INVALID_FIELDS');result=await store.patchSeason(id,version,identity.uid,number,{published:body.published});
      }else throw new HttpError(405,'METHOD_NOT_ALLOWED');
    }else throw new HttpError(405,'METHOD_NOT_ALLOWED');
    admin.json(response,200,result);
  }catch(exception){error(response,exception);}}
  async function handlePublic(request,response,url){try{
    limit(request,'catalogue-public',150,1500);if(request.method!=='GET')throw new HttpError(405,'METHOD_NOT_ALLOWED');
    const suffix=url.pathname.slice('/api/catalogue'.length);let result;
    const playbackMatch = /^\/(tmdb-(?:movie|tv)-[1-9]\d{0,8}|movie-tt\d+|series-\d+|jw-(?:tm|ts)\d+)\/playback$/.exec(suffix);
    if (playbackMatch) {
      params(url, ['season', 'episode']);
      let target = null;
      if (url.searchParams.has('season') || url.searchParams.has('episode')) {
        const season = url.searchParams.get('season'), episode = url.searchParams.get('episode');
        if (!/^\d{1,4}$/.test(season || '') || !/^[1-9]\d{0,4}$/.test(episode || '')) throw new HttpError(400, 'VIDEO_INVALID_EPISODE');
        target = { season: Number(season), episode: Number(episode) };
      }
      await sendPublicText(request, response, JSON.stringify(await store.playback(playbackMatch[1], target)), { type: 'application/json; charset=utf-8' }); return;
    }
    if (suffix === '/featured') {
      params(url, []);
      await sendPublicText(request, response, JSON.stringify({ items: await hero.publicItems() }), { type: 'application/json; charset=utf-8' });
      return;
    }
    if(!suffix){params(url,['query','kind','provider','cursor','limit']);const kind=url.searchParams.get('kind')||'Tous',provider=url.searchParams.get('provider')||'';if(!['Tous','Film','Série','Anime','Animation','Documentaire'].includes(kind)||provider&&!['netflix','prime-video','paramount','disney','marvel'].includes(provider))throw new HttpError(400,'CATALOGUE_INVALID_QUERY');
      const pageLimit=model.integer(Number(url.searchParams.get('limit')||50),200);if(pageLimit<1)throw new HttpError(400,'CATALOGUE_INVALID_NUMBER');
      result=await store.publicPage({query:model.string(url.searchParams.get('query')||'',80),kind,provider,after:url.searchParams.get('cursor')||'',limit:pageLimit});
    }else {params(url,[]);const match=/^\/(tmdb-(?:movie|tv)-[1-9]\d{0,8}|movie-tt\d+|series-\d+|jw-(?:tm|ts)\d+)(?:\/seasons\/(\d{1,4}))?$/.exec(suffix);if(!match)throw new HttpError(404,'CATALOGUE_NOT_PUBLISHED');result=match[2]===undefined?{item:await store.publicGet(match[1]),stale:false}:await store.publicSeason(match[1],Number(match[2]));}
    await sendPublicText(request, response, JSON.stringify(result), { type: 'application/json; charset=utf-8' });
  }catch(exception){error(response,exception);}}
  async function snapshot(){
    const page=await store.publicPage({limit:200}),items=page.items.sort((a,b)=>(a.rank||1000001)-(b.rank||1000001));
    const providers=Object.fromEntries(model.PLATFORM_IDS.map(platform=>[platform,{name:{netflix:'Netflix','prime-video':'Prime Video',paramount:'Paramount+',disney:'Disney+',marvel:'Marvel'}[platform],kind:platform==='marvel'?'universe':'service',sourceURL:'https://www.justwatch.com/fr',itemIds:items.filter(item=>model.platformsFor(item,item.platforms).includes(platform)).map(item=>item.id)}]));
    const known=legacyCollections(root);
    const collections=[...new Set(items.map(item=>item.collection).filter(Boolean))].map(value=>known.get(value)||{id:value,title:value,description:'Les contenus publiés de cette saga.',color:'#376299'});
    return {items,providers,collections,nextCursor:page.nextCursor};
  }
  async function script(request,response){try{limit(request,'catalogue-script',100,1000);const data=await snapshot();const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const discovery={updatedAt:new Date().toISOString(),items:data.items,collections:data.collections};
    await sendPublicText(request, response, `window.HessflixCatalogueApproved=true;window.HessflixCatalogueStatus='ready';window.HessflixCatalogueNext=${json(data.nextCursor)};window.MovixDiscovery=${json(discovery)};window.MovixPlatformCatalogue={...window.MovixDiscovery,country:'FR',checkedAt:${json(new Date().toISOString())},providers:${json(data.providers)}};`);
  }catch(exception){response.writeHead(503,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end("window.HessflixCatalogueApproved=true;window.HessflixCatalogueStatus='unavailable';window.MovixDiscovery={updatedAt:'',items:[],collections:[]};");}}
  return {handleAdmin,handlePublic,script,error};
}
module.exports={createCatalogueRoutes};
