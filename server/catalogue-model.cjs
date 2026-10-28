const {HttpError}=require('./policy.cjs');
const normalise=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu,' ').trim():'';
const fail=code=>{throw new HttpError(400,code);};
const clean=value=>JSON.parse(JSON.stringify(value));
const PLATFORM_IDS=Object.freeze(['netflix','prime-video','paramount','disney','marvel']);
function platforms(value){
  if(!Array.isArray(value)||value.length>PLATFORM_IDS.length||value.some(item=>typeof item!=='string'||!PLATFORM_IDS.includes(item)))fail('CATALOGUE_INVALID_PLATFORMS');
  return PLATFORM_IDS.filter(item=>value.includes(item));
}
function platformsFor(meta,explicit){
  if(explicit!==undefined)return platforms(explicit);
  return PLATFORM_IDS.filter(platform=>meta.availability?.some(offer=>offer.platform===(platform==='marvel'?'disney':platform))&&(platform!=='marvel'||meta.marvel===true));
}
const canonical=(type,id)=>{if(!['movie','tv'].includes(type)||!Number.isSafeInteger(id)||id<=0||id>999999999)fail('CATALOGUE_INVALID_ID');return `tmdb-${type}-${id}`;};
function id(value){if(typeof value!=='string'||!/^tmdb-(movie|tv)-[1-9]\d{0,8}$/.test(value))fail('CATALOGUE_INVALID_ID');return value;}
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('CATALOGUE_INVALID_FIELDS');return value;}
function string(value,max){if(typeof value!=='string'||value.length>max)fail('CATALOGUE_INVALID_TEXT');return value.trim();}
function integer(value,max=99999){if(!Number.isSafeInteger(value)||value<0||value>max)fail('CATALOGUE_INVALID_NUMBER');return value;}
function version(value){if(!Number.isSafeInteger(value)||value<1)fail('CATALOGUE_VERSION_REQUIRED');return value;}
function category(value,type){if(!['Film','Série','Anime'].includes(value)||(value==='Film'&&type!=='movie')||(value==='Série'&&type!=='tv'))fail('CATALOGUE_INVALID_CATEGORY');return value;}
function editor(value,type,previous={}){
  object(value,['title','overview','category','collection','rank','featured','platforms']);const result={...previous};
  for(const key of ['title','overview','collection'])if(key in value)result[key]=string(value[key],key==='overview'?12000:key==='title'?300:80);
  if('category'in value)result.category=category(value.category,type);
  if('rank'in value)result.rank=integer(value.rank,1000000);
  if('featured'in value){if(typeof value.featured!=='boolean')fail('CATALOGUE_INVALID_FIELDS');result.featured=value.featured;}
  if('platforms'in value)result.platforms=platforms(value.platforms);
  return result;
}
function searchKeys(item){
  const keys=new Set();for(const title of [item.title,item.originalTitle,...(item.alternativeTitles||[])].filter(Boolean)){
    const words=normalise(title).split(' ');for(let start=0;start<words.length;start++){const phrase=words.slice(start).join(' ');for(let size=2;size<=Math.min(80,phrase.length);size++){keys.add(phrase.slice(0,size));if(keys.size>=350)return [...keys];}}
  }return [...keys];
}
function projection(entry,seasons=[]){
  const {meta,editor:choice}=entry;
  const visible=seasons.filter(season=>season.published&&season.complete).sort((a,b)=>a.number-b.number);
  const item={...meta,id:entry.aliases?.[0]||entry.id,catalogueId:entry.id,title:choice.title||meta.title,overview:choice.overview||meta.overview,collection:choice.collection||meta.collection||'',
    isAnime:choice.category==='Anime',kind:entry.mediaType==='movie'?'Film':'Série',tmdbSeasons:visible.map(season=>({number:season.number,title:season.title||'',airdate:season.airdate||'',image:season.image||'',episodes:season.publishedEpisodes||0})),
    seasonCount:visible.filter(season=>season.number>0).length,episodeCount:visible.reduce((total,season)=>total+(season.publishedEpisodes||0),0),category:choice.category,
    featured:choice.featured||false,rank:choice.rank||0,heroBackdrop:choice.heroBackdrop||meta.backdrop||'',aliases:entry.aliases||[],publishedAt:entry.publishedAt||entry.updatedAt,updatedAt:entry.updatedAt,status:'published'};
  delete item.editor;delete item.lock;
  item.platforms=platformsFor(meta,choice.platforms);
  item.providerFlags=Object.fromEntries(PLATFORM_IDS.map(platform=>[platform,item.platforms.includes(platform)]));
  return clean({...item,searchKeys:searchKeys(item)});
}
function publicItem(value){const {searchKeys,providerFlags,status,...item}=value;return item;}
module.exports={canonical,id,object,string,integer,version,category,editor,projection,publicItem,normalise,clean,PLATFORM_IDS,platforms,platformsFor};
