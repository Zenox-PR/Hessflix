// Double transactionnel de Firestore réservé aux tests. Jamais utilisé par le serveur normal.
const assert=require('node:assert/strict');
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const field=(value,key)=>key.split('.').reduce((object,name)=>object?.[name],value);
function createTestFirestore(){
  const data=new Map();let pending=Promise.resolve();
  const db={data,collection:path=>new Query(path),doc:path=>new Ref(path),runTransaction:async work=>{
    const result=pending.then(async()=>{const writes=[];let writing=false;
      const tx={get:async reference=>{assert.equal(writing,false,'Toutes les lectures transactionnelles précèdent les écritures.');return reference.get();},set:(reference,value)=>{writing=true;writes.push(()=>data.set(reference.path,copy(value)));},create:(reference,value)=>{writing=true;writes.push(()=>{assert.ok(!data.has(reference.path));data.set(reference.path,copy(value));});},delete:reference=>{writing=true;writes.push(()=>data.delete(reference.path));}};
      const value=await work(tx);writes.forEach(write=>write());return value;
    });pending=result.catch(()=>{});return result;
  },recursiveDelete:async reference=>{for(const key of data.keys())if(key===reference.path||key.startsWith(reference.path+'/'))data.delete(key);}};
  function snapshot(path){return {id:path.split('/').pop(),ref:new Ref(path),exists:data.has(path),data:()=>copy(data.get(path))};}
  class Ref{constructor(path){this.path=path;this.id=path.split('/').pop();}collection(name){return new Query(this.path+'/'+name);}get(){return Promise.resolve(snapshot(this.path));}}
  class Query{constructor(path,filters=[],orders=[],maximum=Infinity,cursor=''){this.path=path;this.filters=filters;this.orders=orders;this.maximum=maximum;this.cursor=cursor;}
    doc(id){return new Ref(this.path+'/'+id);}where(key,op,value){return new Query(this.path,[...this.filters,[key,op,value]],this.orders,this.maximum,this.cursor);}orderBy(key,direction='asc'){return new Query(this.path,this.filters,[...this.orders,[key,direction]],this.maximum,this.cursor);}limit(maximum){return new Query(this.path,this.filters,this.orders,maximum,this.cursor);}startAfter(snap){return new Query(this.path,this.filters,this.orders,this.maximum,snap.ref.path);}
    async get(){let paths=[...data.keys()].filter(path=>path.startsWith(this.path+'/')&&!path.slice(this.path.length+1).includes('/'));
      paths=paths.filter(path=>this.filters.every(([key,op,value])=>op==='array-contains'?field(data.get(path),key)?.includes(value):field(data.get(path),key)===value));
      paths.sort((a,b)=>{for(const [key,direction]of this.orders){const left=key==='__name__'?a:field(data.get(a),key),right=key==='__name__'?b:field(data.get(b),key);if(left!==right)return (left<right?-1:1)*(direction==='desc'?-1:1);}return a.localeCompare(b);});
      if(this.cursor)paths=paths.slice(paths.indexOf(this.cursor)+1);const docs=paths.slice(0,this.maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};
    }
  }
  return db;
}
function seedApprovedLegacy(db){
  const fs=require('node:fs'),path=require('node:path');const root=path.join(__dirname,'../..');
  const read=file=>{const source=fs.readFileSync(path.join(root,file),'utf8');return JSON.parse(source.slice(source.indexOf('{'),source.lastIndexOf('}')+1));};
  const entries=[...new Map([...read('discovery-data.js').items,...read('platform-catalogue-data.js').items].map(item=>[item.id,item])).values()];
  const guides=read('episode-data.js').shows;const {projection}=require('../../server/catalogue-model.cjs');
  entries.forEach((item,index)=>{
    const direct=/\/(movie|tv)\/(\d+)$/.exec(item.imageSource||''),mediaType=item.kind==='Film'?'movie':'tv',tmdbId=direct?Number(direct[2]):1000000+index,id='tmdb-'+mediaType+'-'+tmdbId;
    const episodes=(guides[item.id]?.episodes||[]).filter(value=>!value.airdate||value.airdate<=new Date().toISOString().slice(0,10));
    const seasons=[...new Set(episodes.map(value=>value.season))].map(number=>({number,published:true,complete:true,publishedEpisodes:episodes.filter(value=>value.season===number).length,title:'',airdate:'',image:''}));
    const meta={...item,mediaType,tmdbId,tmdbSeasons:seasons.map(season=>({number:season.number,title:'',episodes:season.publishedEpisodes,airdate:'',image:''})),seasonCount:seasons.length,episodeCount:episodes.length};
    const entry={id,tmdbId,mediaType,meta,editor:{category:mediaType==='movie'?'Film':'Série',title:'',overview:'',collection:item.collection||'',rank:0,featured:item.title==='Interstellar'},aliases:[item.id],status:'published',version:1,createdAt:'2026-10-23T00:00:00Z',updatedAt:'2026-10-23T00:00:00Z',syncedAt:'2026-10-23T00:00:00Z',createdBy:'fixture',updatedBy:'fixture'};
    db.data.set('catalogueEntries/'+id,entry);db.data.set('publicCatalogue/'+id,projection(entry,seasons));
    for(const season of seasons){db.data.set('catalogueEntries/'+id+'/seasons/'+season.number,season);for(const episode of episodes.filter(value=>value.season===season.number))db.data.set('catalogueEntries/'+id+'/seasons/'+season.number+'/episodes/'+episode.number,{number:episode.number,meta:episode,published:true,editor:{title:'',overview:''}});}
  });return db;
}
module.exports={createTestFirestore,seedApprovedLegacy};
