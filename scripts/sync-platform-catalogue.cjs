// Actualisation explicite des sélections : données publiques France, pas de clé API.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {readPublicPage,subscriptionOffers} = require('./lib/platform-source.cjs');
const {selections,extras} = require('./platform-selections.cjs');
const root = path.resolve(__dirname,'..');
const services = {
  netflix:{name:'Netflix',slug:'netflix',provider:'netflix'},
  'prime-video':{name:'Prime Video',slug:'amazon-prime-video',provider:'amazonprimevideo'},
  paramount:{name:'Paramount+',slug:'paramount-plus',provider:'paramountplus'},
  disney:{name:'Disney+',slug:'disney-plus',provider:'disneyplus'}
};
const key = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const genres = {action:'Action',adventure:'Aventure',animation:'Animation',comedy:'Comédie',crime:'Crime',documentation:'Documentaire',drama:'Drame',family:'Famille',fantasy:'Fantastique',history:'Histoire',horror:'Horreur',music:'Musique',romance:'Romance',scifi:'Science-fiction',thriller:'Thriller',war:'Guerre',western:'Western',sport:'Sport'};
const collectionSeeds = [
  ['lord-of-the-rings','Le Seigneur des anneaux','#596343'],['hunger-games','Hunger Games','#ab6841'],['hobbit','Le Hobbit','#716341'],
  ['godfather','Le Parrain','#6b4247'],['top-gun','Top Gun','#466d85'],['mission-impossible','Mission : Impossible','#8b353d'],
  ['quiet-place','Sans un bruit','#5e705d'],['avengers','Avengers','#624d93'],['spider-man','Spider-Man','#ba3549'],
  ['guardians','Les Gardiens de la Galaxie','#8c4d8c'],['marvel-series','Les séries Marvel','#9d3846'],['star-wars','Star Wars','#596f91'],
  ['avatar','Avatar','#197a9b'],['inside-out','Vice-versa','#ba7d9e'],['yellowstone','La famille Dutton','#8e6944'],['dexter','Dexter','#a53d40'],['the-boys','The Boys','#ac4d4a']
];
async function page(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'MovixLocalDiscovery/1.0'}});
  if(!response.ok) throw new Error('Source publique indisponible : '+response.status+' '+new URL(url).pathname);
  return {url:response.url,items:readPublicPage(await response.text())};
}
function combine(old,item) {
  if(!old) return item;
  const richer = item.genres.length > old.genres.length ? item : old;
  return {...richer,offers:[...old.offers,...item.offers]};
}
async function main() {
  const sandbox={window:{}}; vm.runInNewContext(fs.readFileSync(path.join(root,'discovery-data.js'),'utf8'),sandbox);
  const original=sandbox.window.MovixDiscovery.items;
  const checkedAt=new Date().toISOString(); const items=new Map(); const providers={};
  function accept(record,id,seed) {
    const offers=subscriptionOffers(record,services[id].provider); if(!offers.length || !(record.rating>0&&record.rating<=10) || !record.poster) return false;
    const [title,year,overview,collection]=seed;
    if(Number(record.year)!==year || key(record.title)!==key(title)) { console.log('Titre à vérifier : '+title+' / '+record.title); return false; }
    const alias=key(title).replace('thebearsurplaceouaemporter','thebear');
    const known=original.find(item=>key(item.title)===alias&&Number(item.year)===year);
    const itemId=known?.id || 'jw-'+record.id;
    const entry=items.get(itemId)||{...known,id:itemId,title:known?.title||record.title,kind:record.kind,year:String(year),rating:Number(record.rating).toFixed(1).replace('.',','),votes:record.votes||0,genres:known?.genres?.length?known.genres:record.genres.map(value=>genres[value]).filter(Boolean),collection:collection||known?.collection||'',overview,sourceURL:record.sourceURL,ratingSource:'IMDb via JustWatch',poster:'linear-gradient(145deg,#33303b,#14141a)',availability:[],marvel:false,_poster:record.poster};
    if(!entry.availability.some(offer=>offer.platform===id)) entry.availability.push({platform:id,country:'FR',type:'subscription',sourceURL:record.sourceURL,watchURL:offers[0].url,checkedAt,...(offers[0].updatedAt?{sourceUpdatedAt:offers[0].updatedAt}:{})});
    if(id==='disney' && (seed[4]===true || ['Avengers','Avengers : Infinity War','Avengers : Endgame','Spider-Man : Homecoming','Spider-Man : No Way Home'].includes(title))) entry.marvel=true;
    items.set(itemId,entry); return true;
  }
  for(const [id,service] of Object.entries(services)) {
    const candidates=new Map();
    for(const kind of ['films','series']) {
      for(const record of (await page('https://www.justwatch.com/fr/plateforme/'+service.slug+'/'+kind)).items) candidates.set(record.id,combine(candidates.get(record.id),record));
    }
    let accepted=0;
    for(const seed of selections[id]) {
      const record=[...candidates.values()].find(item=>key(item.title)===key(seed[0])&&Number(item.year)===seed[1]);
      if(record&&accept(record,id,seed)) accepted++; else console.log('Non retenu : '+service.name+' / '+seed[0]);
    }
    providers[id]={name:service.name,kind:'service',sourceURL:'https://www.justwatch.com/fr/plateforme/'+service.slug,itemIds:[]};
    console.log(service.name+' : '+accepted+' titres de la sélection vérifiés');
  }
  for(const [id,relative,title,year,overview,collection,marvel] of extras) {
    try {
      const result=await page('https://www.justwatch.com'+relative);
      const canonical=new URL(result.url).pathname.replace(/\/$/,'');
      const record=result.items.find(item=>new URL(item.sourceURL).pathname.replace(/\/$/,'')===canonical);
      if(!record||!accept(record,id,[title,year,overview,collection,marvel])) console.log('Non retenu : '+title);
    } catch(error) {console.log('Non retenu : '+title+' ('+error.message+')');}
  }
  providers.marvel={name:'Univers Marvel',kind:'universe',sourceURL:'https://www.disneyplus.com/fr-fr/browse/page-60f4707d-19bb-4c0c-9390-ab269137be50',itemIds:[]};
  for(const [id,provider] of Object.entries(providers)) {
    provider.itemIds=[...items.values()].filter(item=>id==='marvel'?item.marvel:item.availability.some(offer=>offer.platform===id)).map(item=>item.id);
    const included=provider.itemIds.map(value=>items.get(value));
    const films=included.filter(item=>item.kind==='Film').length,shows=included.filter(item=>item.kind==='Série').length;
    console.log(provider.name+' : '+films+' films / '+shows+' séries');
    if(films<10||shows<10) throw new Error('Sélection insuffisante pour deux Top 10 : '+provider.name+'. Version précédente conservée.');
  }
  const directory=path.join(root,'assets','discovery'); fs.mkdirSync(directory,{recursive:true});
  for(const entry of items.values()) {
    if(!entry.genres.length) {
      const full=(await page(entry.sourceURL)).items.find(item=>item.sourceURL===entry.sourceURL&&String(item.year)===entry.year);
      entry.genres=(full?.genres || []).map(value=>genres[value]).filter(Boolean);
      if(!entry.genres.length) throw new Error('Genres non vérifiables : '+entry.title+'. Version précédente conservée.');
    }
    if(!entry.image) {
      const url='https://images.justwatch.com'+entry._poster.replace('{profile}','s332').replace('{format}','jpg');
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)}); if(!response.ok) throw new Error('Affiche indisponible : '+entry.title);
      const bytes=Buffer.from(await response.arrayBuffer());
      const extension=bytes[0]===255&&bytes[1]===216?'jpg':bytes[0]===137&&bytes[1]===80?'png':bytes.toString('ascii',0,4)==='RIFF'?'webp':null;
      if(!extension) throw new Error('Format d’affiche non reconnu');
      entry.image='assets/discovery/'+entry.id+'.'+extension; fs.writeFileSync(path.join(root,entry.image),bytes);
    }
    delete entry._poster;
  }
  const collections=collectionSeeds.map(([id,title,color])=>({id,title,color,description:'Une sélection pour retrouver cet univers.'}));
  const snapshot={country:'FR',checkedAt,items:[...items.values()],providers,collections};
  fs.writeFileSync(path.join(root,'platform-catalogue-data.js'),'// Généré par scripts/sync-platform-catalogue.cjs. Sources : assets/discovery/PLATFORMS.md.\nwindow.MovixPlatformCatalogue = '+JSON.stringify(snapshot)+';\n');
  fs.writeFileSync(path.join(directory,'PLATFORMS.md'),'# Sélections par plateforme\n\nPays : France (FR). Relevé : '+checkedAt+'.\n\nDisponibilités, métadonnées IMDb et affiches : pages publiques JustWatch France. Chaque titre conserve sa fiche JustWatch et les liens des offres officielles. Seules les offres FR de type FLATRATE du fournisseur exact sont acceptées. Les achats, locations, offres étrangères et chaînes additionnelles Prime sont exclus.\n\n'+Object.values(providers).map(provider=>'- '+provider.name+' : '+provider.sourceURL).join('\n')+'\n\nMarvel est un univers éditorial, pas une plateforme. Ses titres retenus ont une offre Disney+ France vérifiée. Le relevé peut devenir obsolète : vérifier le service avant de souscrire. Une série peut n’avoir que certaines saisons disponibles. Le Top 10 trie les notes IMDb de notre sélection, pas les audiences réelles du service.\n\nLes résumés courts français sont rédigés pour Movix ; aucune description de la source n’est recopiée. Les affiches et marques appartiennent à leurs titulaires. Ce catalogue local ne diffuse aucune vidéo. Actualisation manuelle : node scripts/sync-platform-catalogue.cjs.\n');
  console.log(snapshot.items.length+' titres vérifiés enregistrés.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
