// Guide TMDB chargé saison par saison. Sa numérotation n'est jamais confondue avec TVMaze.
(() => {
  /** @typedef {import('./types/contracts').Episode} Episode */
  /** @param {string} id @param {{new():HTMLElement}} [type] */
  function node(id, type = HTMLElement) { const value = document.getElementById(id); if (!(value instanceof type)) throw new Error('Élément absent'); return value; }
  /** @param {string} tag @param {string} cls @param {string} [label] */
  function make(tag, cls, label = '') { const value=document.createElement(tag); value.className=cls; value.textContent=label; return value; }
  /** @param {import('./types/contracts').CatalogueItem} item @param {string} titleId */
  function mount(item, titleId) {
    const apiCandidate=window.HessflixTMDB; if (!apiCandidate || !item.tmdbId) return;
    const api=apiCandidate, id=item.tmdbId;
    const seasons=item.tmdbSeasons || [];
    const seasonSelect=/** @type {HTMLSelectElement} */(node('season-select',HTMLSelectElement));
    const episodeSelect=/** @type {HTMLSelectElement} */(node('episode-select',HTMLSelectElement));
    const previous=/** @type {HTMLButtonElement} */(node('episode-prev',HTMLButtonElement)), next=/** @type {HTMLButtonElement} */(node('episode-next',HTMLButtonElement));
    const strip=node('season-strip'), list=node('episode-list'), selected=node('episode-selected'), empty=node('episode-empty');
    node('episode-summary').textContent=seasons.length+' saisons répertoriées · '+(item.episodeCount ?? 'Nombre d’')+' épisodes · TMDB';
    const caveat=document.querySelector('#episode-section .title-caveat');
    if(caveat)caveat.textContent='Guide TMDB. Dates et langues de synopsis ne garantissent pas la disponibilité en France ni les pistes VF/VOSTFR. Consultez le service officiel.';
    const label=(/** @type {number} */ number)=>number===0?'Épisodes spéciaux':'Saison '+number;
    const key=()=>{const user=window.MovixAccount?.getUser();return 'hessflix-tmdb-episode-v1:'+(user?.uid||'guest')+':'+(user?.profileId||'primary')+':'+id;};
    let activeKey=key(), sequence=0, currentSeason=seasons.find(season=>season.number>0)?.number ?? seasons[0].number, currentNumber=0;
    /** @type {Map<string,number>} */const pendingSelections=new Map();
    /** @type {Episode[]} */let episodes=[];
    /** @type {Map<number,Episode[]>} */const cache=new Map();
    const retry=document.createElement('button');retry.type='button';retry.className='tmdb-more';retry.textContent='Réessayer le chargement des épisodes';retry.hidden=true;empty.after(retry);
    const personalId=item.catalogueId||'tmdb-tv-'+id;
    function save(explicit=false){
      if(!explicit)return;
      const savedKey=activeKey,revision=crypto.randomUUID(),choice={season:currentSeason,number:currentNumber};
      // A page can close before the personal journal's browser lock is acquired.
      // Keep a profile-scoped recovery marker until that journal is durable.
      try{localStorage.setItem(savedKey,JSON.stringify({...choice,pending:true,revision}));}catch{}
      const operation=window.HessflixPersonal?.saveSelection(personalId,{season:choice.season,episode:choice.number});
      if(!operation)return;
      pendingSelections.set(savedKey,(pendingSelections.get(savedKey)||0)+1);
      void operation.then(result=>{
        if(!result||typeof result!=='object'||!('persistent'in result)||result.persistent!==true)return;
        try{const marker=JSON.parse(localStorage.getItem(savedKey)||'null');if(marker?.revision===revision)localStorage.setItem(savedKey,JSON.stringify({...marker,pending:false}));}catch{}
      }).catch(error=>{if(activeKey===savedKey)selected.textContent='La sélection n’a pas été synchronisée : '+(error instanceof Error?error.message:'réessayez.');}).finally(()=>{pendingSelections.set(savedKey,Math.max(0,(pendingSelections.get(savedKey)||1)-1));});
    }
    function selection(){
      const index=episodes.findIndex(episode=>episode.number===currentNumber), episode=episodes[index];if(!episode)return;
      selected.textContent=label(currentSeason)+', épisode '+episode.number+' : '+(episode.title||'Titre non renseigné')+'. Choisissez cet épisode sur le service officiel.';
      episodeSelect.value=String(episode.number);
      previous.disabled=index<=0&&currentSeason===seasons[0].number;next.disabled=index===episodes.length-1&&currentSeason===seasons[seasons.length-1].number;
      list.querySelectorAll('[data-number]').forEach(card=>{const active=card.getAttribute('data-number')===String(currentNumber);card.setAttribute('aria-pressed',String(active));});
      strip.querySelectorAll('[data-season]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-season')===String(currentSeason))));
      window.dispatchEvent(new CustomEvent('hessflix-episode-selected', { detail: { ready: true, season: currentSeason, episode: episode.number } }));
    }
    function render(){
      list.replaceChildren();episodeSelect.replaceChildren();
      for(const episode of episodes){
        const option=document.createElement('option');option.value=String(episode.number);option.textContent=episode.number+'. '+(episode.title||'Titre non renseigné');episodeSelect.append(option);
        const card=make('div','episode-card tmdb-episode-card');const button=document.createElement('button');button.type='button';button.className='episode-select-card';button.dataset.number=String(episode.number);
        button.setAttribute('aria-label',label(currentSeason)+', épisode '+episode.number+' : '+(episode.title||'Titre non renseigné'));
        const visual=make('span','episode-art');const path=api.image(episode.image);
        if(path){const image=document.createElement('img');image.src=path;image.alt='';image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>image.remove());visual.append(image);}
        visual.append(make('strong','',String(episode.number).padStart(2,'0')));
        const copy=make('span','episode-copy');copy.append(make('strong','',episode.number+'. '+(episode.title||'Titre non renseigné')));
        const date=episode.airdate?new Date(episode.airdate+'T12:00:00Z').toLocaleDateString('fr-FR'):'';
        const future=episode.airdate>new Date().toISOString().slice(0,10);
        copy.append(make('small','',[future?'Diffusion annoncée':'',date,episode.runtime?episode.runtime+' min':''].filter(Boolean).join(' · ')));
        button.append(visual,copy);button.addEventListener('click',()=>{currentNumber=episode.number;save(true);selection();});card.append(button);
        if(episode.overview){const details=document.createElement('details');details.className='episode-synopsis';const summary=document.createElement('summary');summary.textContent='Synopsis de l’épisode';details.append(summary,make('p','',episode.overview));card.append(details);}
        list.append(card);
      }
      selection();
    }
    /** @param {number} number @param {number} [wanted] */
    async function load(number,wanted=0,remember=false){
      const ticket=++sequence;currentSeason=number;seasonSelect.value=String(number);
      list.replaceChildren();selected.textContent='Chargement des épisodes…';empty.hidden=true;retry.hidden=true;
      previous.disabled=next.disabled=episodeSelect.disabled=true;list.setAttribute('aria-busy','true');
      window.dispatchEvent(new CustomEvent('hessflix-episode-selected', { detail: { ready: false } }));
      try{
        let stale=false;
        if(!cache.has(number)){const response=await api.season(id,number);cache.set(number,response.episodes);stale=response.stale;}
        if(ticket!==sequence)return;episodes=cache.get(number)||[];
        currentNumber=(wanted===-1?episodes[episodes.length-1]?.number:episodes.find(episode=>episode.number===wanted)?.number)||episodes[0]?.number||0;
        if(!episodes.length){empty.textContent='Aucun épisode renseigné pour cette saison.';empty.hidden=false;selected.textContent='';episodeSelect.replaceChildren();return;}
        episodeSelect.disabled=false;render();save(remember);if(stale)selected.append(' Dernier guide en cache.');
      }catch{if(ticket!==sequence)return;empty.textContent='Le guide TMDB est temporairement indisponible. La fiche et les liens officiels restent accessibles.';empty.hidden=false;retry.hidden=false;selected.textContent='';episodeSelect.replaceChildren();}
      finally{if(ticket===sequence)list.removeAttribute('aria-busy');}
    }
    function restore(){
      let wanted=0,number=seasons.find(season=>season.number>0)?.number ?? seasons[0].number;
      let recover=false;
      try{const saved=JSON.parse(localStorage.getItem(activeKey)||'null');if(saved&&seasons.some(season=>season.number===saved.season)&&Number.isInteger(saved.number)&&saved.number>0){number=saved.season;wanted=saved.number;recover=saved.pending===true;}}catch{/* Premier épisode par défaut. */}
      const synced=window.HessflixPersonal?.selection(personalId);if(!recover&&synced&&seasons.some(season=>season.number===synced.season)){number=synced.season;wanted=synced.episode;}
      void load(number,wanted,recover);
    }
    for(const season of seasons){
      const option=document.createElement('option');option.value=String(season.number);option.textContent=label(season.number);seasonSelect.append(option);
      const button=document.createElement('button');button.type='button';button.className='season-tab';button.dataset.season=String(season.number);button.setAttribute('aria-controls','episode-list');
      button.append(make('strong','',label(season.number)),make('span','',season.episodes===null?'Épisodes non renseignés':season.episodes+' épisodes'));
      button.addEventListener('click',()=>{void load(season.number,0,true);});strip.append(button);
    }
    seasonSelect.addEventListener('change',()=>{void load(Number(seasonSelect.value),0,true);});
    episodeSelect.addEventListener('change',()=>{currentNumber=Number(episodeSelect.value);save(true);selection();});
    /** @param {number} direction */
    function shift(direction){const index=episodes.findIndex(episode=>episode.number===currentNumber),target=episodes[index+direction];if(target){currentNumber=target.number;save(true);selection();}else{const seasonIndex=seasons.findIndex(season=>season.number===currentSeason),other=seasons[seasonIndex+direction];if(other)void load(other.number,direction<0?-1:0,true);}}
    previous.addEventListener('click',()=>shift(-1));next.addEventListener('click',()=>shift(1));retry.addEventListener('click',()=>{void load(currentSeason,currentNumber);});
    window.MovixAccount?.subscribe(()=>{const nextKey=key();if(nextKey!==activeKey){activeKey=nextKey;restore();}});
    restore();
    window.addEventListener('hessflix-personal-changed',()=>{const synced=window.HessflixPersonal?.selection(personalId);if(!pendingSelections.get(activeKey)&&list.getAttribute('aria-busy')!=='true'&&synced&&(synced.season!==currentSeason||synced.episode!==currentNumber)&&seasons.some(season=>season.number===synced.season))void load(synced.season,synced.episode);});
  }
  window.HessflixTMDBEpisodes={mount};
})();
