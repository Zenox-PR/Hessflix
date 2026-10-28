// Activité par compte et profil. Une fiche consultée n'est jamais un visionnage.
(() => {
  const validId=value=>typeof value==='string'&&/^(movie-tt\d+|series-\d+|jw-(tm|ts)\d+|tmdb-(movie|tv)-[1-9]\d{0,8})$/.test(value);
  const empty=()=>({version:1,progress:[],history:[],seconds:0,days:{},lastEnd:0});
  const validChoice=value=>value===undefined||(value&&Number.isInteger(value.season)&&value.season>=0&&value.season<10000&&Number.isInteger(value.episode)&&value.episode>0&&value.episode<100000);
  const eventKey=value=>value.id+':'+(value.choice?value.choice.season+':'+value.choice.episode:'title');
  function dayKey(time){const d=new Date(time);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function validate(value){
    if(!value||value.version!==1||!Array.isArray(value.progress)||value.progress.length>500||!Array.isArray(value.history)||value.history.length>1000||!Number.isFinite(value.seconds)||value.seconds<0||value.seconds>1e10||!Number.isFinite(value.lastEnd)||!value.days||typeof value.days!=='object'||Array.isArray(value.days))throw new Error('Invalid activity');
    for(const item of [...value.progress,...value.history])if(!item||!validId(item.id)||!Number.isFinite(item.at)||!validChoice(item.choice))throw new Error('Invalid activity entry');
    if(value.progress.some(item=>!['in-progress','completed'].includes(item.status)))throw new Error('Invalid status');
    for(const [day,seconds] of Object.entries(value.days))if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(seconds)||seconds<0||seconds>86400)throw new Error('Invalid day');
    return value;
  }
  function createStore({storage,now=Date.now,onChange=()=>{}}){
    let identity=null,persistent=true;const memory=new Map();
    const key=()=>identity?'hessflix-activity-v1:'+identity:null;
    function read(){const k=key();if(!k)return empty();if(!persistent&&memory.has(k))return structuredClone(memory.get(k));try{const raw=storage.getItem(k);const result=raw?validate(JSON.parse(raw)):empty();memory.set(k,result);return structuredClone(result);}catch{persistent=false;return structuredClone(memory.get(k)||empty());}}
    function write(work){const k=key();if(!k)throw new Error('Connectez-vous pour utiliser votre suivi.');const value=read();work(value);validate(value);memory.set(k,value);if(persistent){try{storage.setItem(k,JSON.stringify(value));}catch{persistent=false;}}onChange();return snapshot();}
    function snapshot(){return {...read(),persistent,identity};}
    return {
      setAccount(account){const next=account?account.uid+':'+(account.profileId||'primary'):null;if(next!==identity){identity=next;persistent=true;onChange();}},snapshot,
      mark(item,status,choice){
        if(!validId(item.id)||!['in-progress','completed'].includes(status)||!validChoice(choice))throw new Error('Suivi invalide.');
        return write(data=>{
          const at=now(),entry={id:item.id,at,...(choice?{choice:{...choice}}:{})};
          if(status==='completed'&&!data.history.some(value=>eventKey(value)===eventKey(entry)))data.history.unshift(entry);
          const complete=status==='completed'&&(!choice||(Number.isInteger(item.episodeCount)&&item.episodeCount>0&&data.history.filter(value=>value.id===item.id&&value.choice).length>=item.episodeCount));
          data.progress=[{...entry,status:complete?'completed':'in-progress'},...data.progress.filter(value=>value.id!==item.id)].slice(0,500);data.history=data.history.slice(0,1000);
        });
      },
      removeProgress(id){if(!validId(id))throw new Error('Identifiant invalide.');return write(data=>{data.progress=data.progress.filter(item=>item.id!==id);});},
      removeHistory(entry){return write(data=>{data.history=data.history.filter(item=>eventKey(item)!==eventKey(entry));const record=data.progress.find(item=>item.id===entry.id);if(record)record.status='in-progress';});},
      addTime(start,end){
        if(!identity||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>15000)return snapshot();
        return write(data=>{
          let cursor=Math.max(start,Math.min(data.lastEnd,end));if(cursor>=end)return;
          while(cursor<end){const date=new Date(cursor),midnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime(),until=Math.min(end,midnight),seconds=(until-cursor)/1000,day=dayKey(cursor);data.days[day]=Math.min(86400,(data.days[day]||0)+seconds);data.seconds+=seconds;cursor=until;}
          data.lastEnd=end;
          const keys=Object.keys(data.days).sort();for(const day of keys.slice(0,Math.max(0,keys.length-366)))delete data.days[day];
        });
      }
    };
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={createStore,dayKey,validId};return;}
  let safeStorage;try{safeStorage=window.localStorage;}catch{safeStorage={getItem(){throw new Error('Storage unavailable');},setItem(){throw new Error('Storage unavailable');}};}
  const emit=()=>window.dispatchEvent(new Event('hessflix-activity-changed'));
  const personal=window.HessflixPersonal;
  const store={snapshot:()=>personal.snapshot(),setAccount(){},mark:(item,status,choice)=>personal.mark(item,status,choice),removeProgress:id=>personal.removeProgress(id),removeHistory:entry=>personal.removeHistory(entry),addTime:(start,end)=>personal.addTime(start,end,dayKey(start))};
  let account=null,connected=false,lastTick=Date.now(),lastInput=Date.now(),timeTask=Promise.resolve();
  const identity=()=>account?account.uid+':'+(account.profileId||'primary'):null;
  async function tick(force=false){
    const now=Date.now(),start=lastTick;lastTick=now;
    if(!identity()||account?.profileReady===false||(!force&&document.hidden)||now-start>15000)return;
    const end=Math.min(now,lastInput+90000);if(end<=start)return;const owner=identity();
    const update=()=>{if(owner===identity())return store.addTime(start,end);};
    timeTask=timeTask.catch(()=>{}).then(()=>navigator.locks?navigator.locks.request('hessflix-time:'+owner,update):update()).catch(()=>{});await timeTask;
  }
  function connect(){if(connected||!window.MovixAccount)return;connected=true;personal.connect();window.MovixAccount.subscribe(next=>{if(identity()!==(next?next.uid+':'+(next.profileId||'primary'):null)){void tick();lastTick=lastInput=Date.now();}account=next;});}
  function favoriteKey(){return 'movix-favorites-v1:'+(account?.uid||'guest')+':'+(account?.profileId||'primary');}
  function favorites(){return personal.favorites();}
  const api={connect,snapshot:()=>store.snapshot(),favorites,flush:()=>timeTask,
    mark:(item,status,choice)=>store.mark(item,status,choice),removeProgress:id=>store.removeProgress(id),removeHistory:entry=>store.removeHistory(entry),
    removeFavorite(id){return personal.setFavorite(id,false);},
    dayKey,
    mountTitle(item,series){
      const actions=document.getElementById('title-actions');if(!actions||!validId(item.id))return;
      const group=document.createElement('div');group.className='title-follow';group.setAttribute('aria-label','Votre suivi personnel');
      const resume=document.createElement('button'),watched=document.createElement('button'),later=document.createElement('button'),message=document.createElement('p');
      resume.type=watched.type=later.type='button';resume.className=watched.className=later.className='title-secondary';later.textContent='À voir';message.className='title-follow-message';message.setAttribute('role','status');group.append(later,resume,watched,message);actions.after(group);
      function choice(){const season=document.getElementById('season-select'),episode=document.getElementById('episode-select');if(series&&season instanceof HTMLSelectElement&&episode instanceof HTMLSelectElement&&!episode.disabled&&season.options.length&&episode.options.length)return {season:Number(season.value),episode:Number(episode.value)};}
      function render(){if(/^(Synchronisation en attente :|Vos listes sont synchronisées|Les autres modifications sont synchronisées|Chargement de vos listes)/.test(message.textContent))message.textContent=personal.message();const current=choice(),state=store.snapshot(),done=state.history.some(entry=>eventKey(entry)===eventKey({id:item.id,choice:current}));resume.textContent='À reprendre';resume.setAttribute('aria-pressed',String(state.progress.some(entry=>entry.id===item.id&&entry.status==='in-progress')));watched.textContent=done?'✓ Vu':current?'Marquer cet épisode comme vu':'Marquer comme vu';watched.setAttribute('aria-pressed',String(done));resume.disabled=watched.disabled=state.profileReady===false||(series&&!!item.tmdbSeasons?.length&&!current);later.disabled=state.profileReady===false;later.setAttribute('aria-pressed',String(personal.watchlist().includes(item.id)));}
      later.addEventListener('click',async()=>{try{await personal.setWatchlist(item.id,!personal.watchlist().includes(item.id));message.textContent=personal.message();}catch(error){message.textContent=error.message;}});
      for(const [button,status]of [[resume,'in-progress'],[watched,'completed']])button.addEventListener('click',async()=>{try{await store.mark(item,status,choice());message.textContent=personal.message();render();}catch(error){message.textContent=error.message;}});
      window.addEventListener('hessflix-activity-changed',render);window.addEventListener('hessflix-episode-selected',render);render();
    }
  };
  window.HessflixActivity=api;
  for(const event of ['pointerdown','keydown','scroll','pointermove'])window.addEventListener(event,()=>{lastInput=Date.now();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)void tick(true);else lastTick=lastInput=Date.now();});
  window.addEventListener('pagehide',()=>{void tick(true);});
  window.addEventListener('storage',event=>{if(event.key?.startsWith('hessflix-activity-v1:')||event.key?.startsWith('movix-favorites-v1:'))emit();});
  window.addEventListener('hessflix-favorites-changed',emit);window.addEventListener('movix-auth-status',connect);
  setInterval(()=>{void tick();},5000);queueMicrotask(connect);
})();
