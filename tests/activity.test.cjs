const {test}=require('node:test');const assert=require('node:assert/strict');
const {createStore,dayKey}=require('../profile-activity.js');
function setup(){const data=new Map();let now=new Date(2026,9,25,12).getTime();const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};const store=createStore({storage,now:()=>now});store.setAccount({uid:'alice',profileId:'primary'});return {store,data,storage,time:now,setTime:value=>{now=value;}};}
const movie={id:'tmdb-movie-1576',kind:'Film'},series={id:'tmdb-tv-66732',kind:'Série',episodeCount:2};
test('activité : historique réel déclaré, états, dédoublonnage et persistance',()=>{
 const {store,data,storage}=setup();assert.equal(store.snapshot().history.length,0);store.mark(movie,'in-progress');assert.equal(store.snapshot().history.length,0);assert.equal(store.snapshot().progress[0].status,'in-progress');
 store.mark(movie,'completed');store.mark(movie,'completed');assert.equal(store.snapshot().history.length,1);assert.equal(store.snapshot().progress[0].status,'completed');
 const second=createStore({storage});second.setAccount({uid:'alice'});assert.equal(second.snapshot().history.length,1);assert.equal(data.size,1);
 store.removeHistory(store.snapshot().history[0]);assert.equal(store.snapshot().history.length,0);assert.equal(store.snapshot().progress[0].status,'in-progress');store.removeProgress(movie.id);assert.equal(store.snapshot().progress.length,0);
});
test('activité : épisodes suivis individuellement et série en cours tant qu’elle est incomplète',()=>{
 const {store}=setup();store.mark(series,'completed',{season:1,episode:1});assert.equal(store.snapshot().history.length,1);assert.equal(store.snapshot().progress[0].status,'in-progress');
 store.mark(series,'completed',{season:1,episode:1});assert.equal(store.snapshot().history.length,1);store.mark(series,'completed',{season:1,episode:2});assert.equal(store.snapshot().history.length,2);assert.equal(store.snapshot().progress[0].status,'completed');
 store.removeHistory(store.snapshot().history[0]);assert.equal(store.snapshot().progress[0].status,'in-progress');
});
test('activité : isolation stricte des comptes et profils, aucune fusion au logout',()=>{
 const {store}=setup();store.mark(movie,'completed');store.setAccount({uid:'alice',profileId:'second'});assert.equal(store.snapshot().history.length,0);store.mark(series,'in-progress');
 store.setAccount({uid:'bob'});assert.equal(store.snapshot().progress.length,0);store.setAccount(null);assert.throws(()=>store.mark(movie,'completed'));assert.equal(store.snapshot().history.length,0);
 store.setAccount({uid:'alice'});assert.equal(store.snapshot().history.length,1);assert.equal(store.snapshot().progress[0].id,movie.id);
});
test('activité : temps sans double compte entre onglets, suspension et passage à minuit',()=>{
 const {store,time}=setup();store.addTime(time,time+5000);store.addTime(time,time+5000);assert.equal(store.snapshot().seconds,5);store.addTime(time+3000,time+8000);assert.equal(store.snapshot().seconds,8);assert.equal(store.snapshot().days[dayKey(time)],8);
 store.addTime(time+8000,time+120000);assert.equal(store.snapshot().seconds,8);
 const midnight=new Date(2026,9,26).getTime();store.addTime(midnight-2000,midnight+3000);assert.equal(store.snapshot().days[dayKey(midnight-1000)],10);assert.equal(store.snapshot().days[dayKey(midnight)],3);
});
test('activité : identifiants invalides rejetés, stockage cassé conservé et mode mémoire honnête',()=>{
 const {store,data}=setup();for(const id of ['../../secret','javascript:alert(1)','<img onerror=1>'])assert.throws(()=>store.mark({id},'completed'));assert.throws(()=>store.mark(movie,'completed',{season:-1,episode:1}));
 const key='hessflix-activity-v1:alice:primary';data.set(key,'{broken');store.mark(movie,'in-progress');assert.equal(data.get(key),'{broken');assert.equal(store.snapshot().persistent,false);assert.equal(store.snapshot().progress.length,1);
 const memory=createStore({storage:{getItem:()=>null,setItem:()=>{throw new Error('full');}}});memory.setAccount({uid:'alice'});memory.mark(movie,'completed');memory.mark(series,'in-progress');assert.equal(memory.snapshot().persistent,false);assert.equal(memory.snapshot().history.length,1);assert.equal(memory.snapshot().progress.length,2);
});
