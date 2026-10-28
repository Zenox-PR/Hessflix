// Univers visuels : contenus publiés et classés par l'administration.
(() => {
  const themes = {
    netflix:{name:'Netflix',accent:'#e50914',glow:'#690810',background:'#090909',surface:'#181112',heading:'Des histoires. Des émotions. Sans limite.',description:'Thrillers, séries et grandes histoires : la sélection Hessflix pour votre univers Netflix.'},
    'prime-video':{name:'Prime Video',accent:'#008ec5',glow:'#064569',background:'#070f19',surface:'#101f30',heading:'La prochaine aventure commence ici.',description:'Action, aventures et séries à suivre : la sélection Hessflix pour votre univers Prime Video.'},
    paramount:{name:'Paramount+',accent:'#2879ff',glow:'#082c74',background:'#070d20',surface:'#111d3c',heading:'Le grand spectacle, à chaque instant.',description:'Des films cultes aux séries qui vous emportent : la sélection Hessflix pour votre univers Paramount+.'},
    disney:{name:'Disney+',accent:'#8bdfff',glow:'#142878',background:'#080e25',surface:'#151e43',heading:'Un peu de magie. Des souvenirs infinis.',description:'Animation, aventures, Marvel et séries : la sélection Hessflix pour votre univers Disney+.'},
    marvel:{name:'Marvel',accent:'#ed1d24',glow:'#650b17',background:'#0c0b10',surface:'#21131c',heading:'De grands pouvoirs. De plus grandes histoires.',description:'Héros, équipes et multivers : la sélection Hessflix pour votre univers Marvel. Marvel n’est pas un service de streaming.'}
  };
  const rawId=document.body.dataset.platform;
  if(!rawId || !Object.hasOwn(themes,rawId)) throw new Error('Plateforme inconnue');
  const id=/** @type {import('./types/contracts').PlatformId} */(rawId);
  const theme=themes[id];
  /** @template {Element} T @param {string} selector @param {{new():T}} type @returns {T} */
  function get(selector,type) {const node=document.querySelector(selector);if(!(node instanceof type))throw new Error('Élément manquant : '+selector);return node;}
  document.title=theme.name+' — Hessflix';
  for(const property of ['accent','glow','background','surface']) document.documentElement.style.setProperty('--'+property,theme[/** @type {'accent'|'glow'|'background'|'surface'} */(property)]);
  get('#universe-name',HTMLElement).textContent=theme.name;
  get('#universe-eyebrow',HTMLElement).textContent='L’univers '+theme.name;
  get('#universe-heading',HTMLElement).textContent=theme.heading;
  get('#universe-description',HTMLElement).textContent=theme.description;
  get('#collection-title',HTMLElement).textContent=id==='marvel'?'Votre prochain héros vous attend':'À découvrir sur '+theme.name;
  const logo=get('#universe-logo',HTMLImageElement);logo.src='assets/platforms/'+id+'.png';logo.alt=theme.name;
  const switcher=get('#universe-switch',HTMLElement);const label=document.createElement('span');label.textContent='Changer d’univers';switcher.replaceChildren(label);
  for(const [key,value] of Object.entries(themes)) {const link=document.createElement('a');link.href=key+'.html';link.textContent=value.name;if(key===id)link.setAttribute('aria-current','page');switcher.append(link);}
  const candidate=window.MovixPlatformCatalogue;
  if(!candidate) {get('#availability-date',HTMLElement).textContent='Sélection indisponible. Rechargez la page.';get('#featured-title',HTMLButtonElement).disabled=true;return;}
  const data=candidate;
  const provider=data.providers[id];
  const titles=data.items.filter(item=>provider.itemIds.includes(item.id||'') && window.MovixModel.platformsFor(item).includes(id));
  const source=get('#provider-source',HTMLAnchorElement);source.href=provider.sourceURL;source.textContent='Vérifier la disponibilité en France ↗';
  const offerDates=titles.flatMap(item=>(item.availability||[]).map(offer=>offer.checkedAt||'')).filter(Boolean).sort();
  get('#availability-date',HTMLElement).textContent=titles.length+' titres publiés · Sélection Hessflix · France'+(offerDates.length?' · liens vérifiés le '+new Date(offerDates[0]).toLocaleDateString('fr-FR'):'');
  /** @type {import('./types/contracts').BrowseFilter} */
  const state={query:'',kind:'Tous',genre:'',collection:'',favorites:false};
  const search=get('#universe-search',HTMLInputElement);
  const grid=get('#universe-catalogue',HTMLElement);
  const sections=get('#discovery-sections',HTMLElement);
  const dialog=get('#title-dialog',HTMLDialogElement);
  const ui=window.MovixCatalogueUI.create({dialog,content:get('#title-dialog-content',HTMLElement),notice:get('#discovery-notice',HTMLElement),onFavoritesChange(){if(state.favorites)renderTitles();}});
  function renderTitles() {
    let filtered=window.MovixModel.filterItems(titles,state);
    if(state.favorites)filtered=filtered.filter(ui.isFavorite);
    grid.replaceChildren(...filtered.map(item=>ui.createCard(item)));ui.refresh();
    get('#universe-count',HTMLElement).textContent=filtered.length+' titre'+(filtered.length>1?'s':'');
    get('#empty-state',HTMLElement).hidden=filtered.length>0;
    sections.hidden=!!(state.query.trim()||state.kind!=='Tous'||state.genre||state.collection||state.favorites);
    const collection=data.collections.find(item=>item.id===state.collection);
    get('#universe-selection-title',HTMLElement).textContent=collection?.title||state.genre||(state.favorites?'Mes favoris dans cet univers':'Toute la sélection '+theme.name);
    document.querySelectorAll('[data-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button instanceof HTMLElement&&button.dataset.kind===state.kind)));
    get('[data-local-favorites]',HTMLElement).setAttribute('aria-pressed',String(!!state.favorites));
  }
  /** @param {Partial<import('./types/contracts').BrowseFilter>} options */
  function filter(options) {
    Object.assign(state,{query:'',kind:'Tous',genre:'',collection:'',favorites:false},options);search.value=state.query;renderTitles();
    get('#universe-results',HTMLElement).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }
  search.addEventListener('input',()=>{state.query=search.value;renderTitles();});
  document.querySelectorAll('[data-kind]').forEach(button=>{if(button instanceof HTMLButtonElement)button.addEventListener('click',()=>filter({kind:button.dataset.kind||'Tous',query:search.value}));});
  get('[data-local-favorites]',HTMLElement).addEventListener('click',()=>filter({favorites:!state.favorites}));
  get('#reset-search',HTMLElement).addEventListener('click',()=>{filter({});search.focus();});
  get('#universe-reset',HTMLElement).addEventListener('click',()=>filter({}));
  const featuredNames={netflix:'Stranger Things','prime-video':'Reacher',paramount:'Top Gun : Maverick',disney:'Avatar',marvel:'Avengers : Endgame'};
  const featured=titles.find(item=>item.title===featuredNames[id])||window.MovixModel.topRated(titles,'Film')[0]||titles[0];
  get('#featured-title',HTMLButtonElement).disabled=!featured;
  get('#featured-title',HTMLElement).addEventListener('click',()=>{if(featured)window.HessflixTitles.open(featured);});
  get('#close-title',HTMLElement).addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  window.MovixDiscoveryContext={updatedAt:data.checkedAt.slice(0,10),items:titles,collections:data.collections.filter(collection=>titles.filter(item=>item.collection===collection.id).length>=2)};
  window.MovixBrowse={items:titles,createCard:ui.createCard,showDetails:ui.showDetails,filter};
  renderTitles();
})();
