// Recherche et pagination du catalogue validé, jamais de recherche TMDB publique.
(() => {
  const a=window.HessflixTMDB,b=window.MovixBrowse,g=document.getElementById('catalogue-cards');
  if(!a||!b||!g||document.body.dataset.platform)return;
  const api=a,browse=b,grid=g;
  const status=document.createElement('p');status.className='tmdb-status';status.setAttribute('role','status');
  const more=document.createElement('button');more.type='button';more.className='tmdb-more';more.textContent='Afficher plus';more.hidden=true;grid.after(status,more);
  /** @type {import('./types/contracts').BrowseFilter} */let filter={query:'',kind:'Tous'};
  let ticket=0,timer=0,cursor='';
  /** @type {AbortController|undefined} */let controller;
  /** @type {import('./types/contracts').CatalogueItem[]} */let items=[];
  /** @param {boolean} append */
  async function load(append){
    const revision=++ticket;controller?.abort();controller=new AbortController();more.hidden=true;
    if(filter.favorites||filter.genre||filter.collection||(!filter.query.trim()&&filter.kind==='Tous'))return;
    status.textContent='Recherche dans les contenus publiés…';
    try{
      const response=await api.page('?'+new URLSearchParams({query:filter.query.trim(),kind:filter.kind,limit:'50',...(append&&cursor?{cursor}:{})}),controller.signal);
      if(revision!==ticket)return;
      items=[...new Map([...(append?items:[]),...response.items].map(item=>[item.id,item])).values()];
      cursor=response.nextCursor||'';grid.replaceChildren(...items.map(item=>browse.createCard(item)));
      const count=document.getElementById('result-count');if(count)count.textContent=items.length+' contenus publiés chargés';
      const empty=document.getElementById('catalogue-empty');if(empty)empty.hidden=items.length>0;
      status.textContent=cursor?'Uniquement les contenus validés par l’administration. Afficher plus pour poursuivre la recherche.':'Uniquement les contenus validés par l’administration.';more.textContent='Afficher plus';more.hidden=!cursor;
      window.dispatchEvent(new Event('movix-cards-rendered'));
    }catch{
      if(revision!==ticket)return;
      grid.replaceChildren();status.textContent='Catalogue indisponible. Aucun contenu non validé n’est utilisé en remplacement.';
      more.textContent='Réessayer';more.hidden=false;
    }
  }
  window.addEventListener('hessflix-filter',event=>{
    if(!(event instanceof CustomEvent))return;filter=/** @type {import('./types/contracts').BrowseFilter} */(event.detail);
    ticket++;controller?.abort();clearTimeout(timer);more.hidden=true;status.textContent='';cursor='';items=[];
    timer=window.setTimeout(()=>{void load(false);},250);
  });
  more.addEventListener('click',()=>{void load(!!cursor);});
  const root=document.getElementById('discovery-sections');
  if(root&&window.HessflixCatalogueNext){
    const button=document.createElement('button');button.type='button';button.className='tmdb-more';button.textContent='Parcourir les autres contenus publiés';let after=window.HessflixCatalogueNext;
    const list=document.createElement('div');list.className='catalogue';root.append(button,list);
    button.addEventListener('click',async()=>{button.disabled=true;try{const result=await api.page('?'+new URLSearchParams({cursor:after||'',limit:'100'}));list.append(...result.items.map(item=>browse.createCard(item)));after=result.nextCursor||'';button.hidden=!after;}catch{button.textContent='Réessayer';}finally{button.disabled=false;}});
  }
})();
