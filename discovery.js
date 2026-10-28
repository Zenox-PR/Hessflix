/* Rangées éditoriales. Les classements sont calculés, jamais des notes inventées. */
(() => {
  const candidateRoot = document.getElementById('discovery-sections');
  const candidateData=window.MovixDiscoveryContext || window.MovixDiscovery;
  if (!window.MovixBrowse || !candidateData || !candidateRoot) return;
  const browse = window.MovixBrowse;
  const data = candidateData;
  const root = candidateRoot;
  /** @typedef {import('./types/contracts').CatalogueItem} Item */
  /** @typedef {{id:string,title:string,eyebrow:string,description:string,items:Item[],ranked?:boolean,kind?:string,genre?:string}} Row */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  /** @param {string} tag @param {string} className @param {string} [text] */
  function make(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  /** @param {string[]} ids */
  const pick = ids => ids.flatMap(id => data.items.filter(item => item.id === id));
  /** @param {string} genre */
  const genre = genre => data.items.filter(item => item.genres?.includes(genre));
  /** @type {Row[]} */
  const rows = [
    { id:'tendances', title:'Tendances à découvrir', eyebrow:'L’ENVIE DU MOMENT', description:'Grands spectacles, nouvelles obsessions et histoires qui font parler. Notre sélection éditoriale.', items:pick(['movie-tt15239678','series-44933','movie-tt9362722','series-49041','movie-tt1160419','series-46562','movie-tt0816692','series-2993','movie-tt1877830','series-55138','movie-tt2096673','series-54198']) },
    { id:'films-populaires', title:'Films populaires · Top 10', eyebrow:'LE CLASSEMENT CINÉMA', description:'Du n° 1 au n° 10 : les films les mieux notés de notre sélection. Notes spectateurs IMDb sur 10.', items:window.MovixModel.topRated(data.items, 'Film'), ranked:true, kind:'Film' },
    { id:'series-populaires', title:'Séries populaires · Top 10', eyebrow:'ENCORE UN ÉPISODE', description:'Du n° 1 au n° 10 : les séries les mieux notées de notre sélection. Notes TVMaze sur 10.', items:window.MovixModel.topRated(data.items, 'Série'), ranked:true, kind:'Série' },
    { id:'thrillers', title:'Thrillers & mystères', eyebrow:'NE VOUS FIEZ À PERSONNE', description:'Des secrets, des fausses pistes et une tension qui ne vous lâche plus.', items:genre('Thriller'), genre:'Thriller' },
    { id:'science-fiction', title:'Et si tout était possible ?', eyebrow:'SCIENCE-FICTION', description:'Voyagez plus loin que les étoiles, le temps et la réalité.', items:genre('Science-fiction'), genre:'Science-fiction' },
    { id:'action', title:'Action & grandes aventures', eyebrow:'LE PLEIN DE SENSATIONS', description:'Des quêtes impossibles et des héros qui ne reculent devant rien.', items:data.items.filter(item => item.genres?.some(value => ['Action','Aventure'].includes(value))), genre:'Aventure' },
    { id:'animation', title:'À partager en famille', eyebrow:'ANIMATION & IMAGINATION', description:'Des univers dessinés pour rêver, rire et parfois verser une petite larme.', items:genre('Animation'), genre:'Animation' },
    { id:'drames', title:'Des histoires qui marquent', eyebrow:'ÉMOTIONS FORTES', description:'Des personnages et des destins que l’on n’oublie pas en quittant l’écran.', items:genre('Drame'), genre:'Drame' }
  ];
  if(document.body.dataset.platform) {
    rows[0].items=[...data.items].sort((a,b)=>Number(b.year)-Number(a.year)).slice(0,14);
    rows[0].description='Des titres à découvrir dans cet univers, classés ici par année. Sélection éditoriale.';
    rows[1].description='Du n° 1 au n° 10 : les films les mieux notés de cette sélection. Notes IMDb via JustWatch.';
    rows[2].description='Du n° 1 au n° 10 : les séries les mieux notées de cette sélection. Notes IMDb via JustWatch.';
  }
  // Les tendances restent éditoriales, même si un titre source n'est plus disponible.
  if (rows[0].items.length < 8) rows[0].items = [...data.items].sort((a,b) => Number(b.year) - Number(a.year)).slice(0,14);
  if(data.items.some(item=>item.rank))rows[0].items=[...data.items].sort((a,b)=>(a.rank||1000001)-(b.rank||1000001)).slice(0,14);
  if(window.HessflixCatalogueApproved){rows[0].description='Une sélection de contenus validés et publiés par Hessflix.';rows[1].description=rows[2].description='Les mieux notés parmi les contenus publiés. La source de chaque note est indiquée sur sa fiche.';}
  const shortcuts = make('nav','discovery-shortcuts'); shortcuts.setAttribute('aria-label','Explorer les sélections');
  for (const [id,title] of [['tendances','Tendances'],['films-populaires','Top films'],['series-populaires','Top séries'],['sagas','Les sagas'],['thrillers','Thrillers'],['animation','En famille']]) {
    if(id==='sagas' ? !data.collections.length : !rows.some(row=>row.id===id&&row.items.length)) continue;
    const link = document.createElement('a'); link.href = '#' + id; link.textContent = title; shortcuts.append(link);
  }
  root.append(shortcuts);
  /** @param {HTMLElement} section @param {HTMLElement} rail @param {HTMLElement} actions @param {string} title */
  function carousel(section, rail, actions, title) {
    rail.id = section.id + '-rail'; rail.setAttribute('aria-label', title); rail.tabIndex = 0;
    const previous = document.createElement('button'); const next = document.createElement('button');
    previous.type = next.type = 'button'; previous.className = next.className = 'rail-arrow';
    previous.textContent = '‹'; next.textContent = '›';
    previous.setAttribute('aria-label','Précédent : ' + title); next.setAttribute('aria-label','Suivant : ' + title);
    previous.setAttribute('aria-controls',rail.id); next.setAttribute('aria-controls',rail.id);
    actions.append(previous,next);
    let visible = false, inhibitedUntil = 0;
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); }, { threshold:.35 });
    observer.observe(rail);
    const behavior = () => reduced.matches ? 'instant' : 'smooth';
    const step = () => (rail.firstElementChild?.getBoundingClientRect().width || 211) + 16;
    function update() {
      previous.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 3;
    }
    /** @param {number} direction */
    function move(direction) { inhibitedUntil = Date.now() + 22000; rail.scrollBy({left:direction * Math.max(step(),rail.clientWidth * .8),behavior:behavior()}); }
    previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    rail.addEventListener('scroll', update, {passive:true});
    rail.addEventListener('keydown', event => {
      if (event.target !== rail) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
    });
    rail.addEventListener('wheel', () => { inhibitedUntil = Date.now() + 22000; }, {passive:true});
    section.addEventListener('pointerleave', () => { inhibitedUntil = Date.now() + 10000; });
    let dragging = false, startX = 0, startScroll = 0, dragged = false;
    rail.addEventListener('pointerdown', event => {
      inhibitedUntil = Date.now() + 22000;
      if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target instanceof Element && event.target.closest('.favorite-button'))) return;
      dragging = true; dragged = false; startX = event.clientX; startScroll = rail.scrollLeft;
    });
    rail.addEventListener('pointermove', event => {
      if (!dragging) return;
      const distance = event.clientX - startX;
      if (Math.abs(distance) > 6) { dragged = true; rail.classList.add('dragging'); rail.setPointerCapture(event.pointerId); rail.scrollLeft = startScroll - distance; }
    });
    const release = () => { dragging = false; rail.classList.remove('dragging'); };
    rail.addEventListener('pointerup', release); rail.addEventListener('pointercancel', release);
    rail.addEventListener('pointerleave', () => { if (!dragged) release(); });
    rail.addEventListener('click', event => { if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; } }, true);
    // Le focus, le survol, le tactile et la préférence de mouvement gardent la priorité.
    window.setInterval(() => {
      if (!visible || document.hidden || reduced.matches || dragging || section.matches(':hover') || section.contains(document.activeElement) || Date.now() < inhibitedUntil) return;
      if (rail.scrollWidth <= rail.clientWidth + 3) return;
      rail.scrollTo({left:rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 3 ? 0 : rail.scrollLeft + step(),behavior:'smooth'});
    }, 9000);
    new ResizeObserver(update).observe(rail); requestAnimationFrame(update);
  }
  /** @param {string} id @param {string} title @param {string} eyebrow @param {string} description */
  function heading(id,title,eyebrow,description) {
    const section = make('section','discovery-row'); section.id = id; section.setAttribute('aria-labelledby',id + '-title');
    const head = make('div','section-heading'); const copy = make('div',''); const h2 = make('h2','',title); h2.id = id + '-title';
    copy.append(make('p','eyebrow',eyebrow),h2); const actions = make('div','row-actions'); head.append(copy,actions);
    const rail = make('div','media-rail'); section.append(head,make('p','row-description',description),rail);
    return {section,actions,rail};
  }
  /** @param {Row} row */
  function renderRow(row) {
    if (!row.items.length) return;
    const {section,actions,rail} = heading(row.id,row.title,row.eyebrow,row.description);
    const all = document.createElement('button'); all.type = 'button'; all.className = 'text-button'; all.textContent = 'Tout voir ↗';
    all.setAttribute('aria-label','Tout voir : ' + row.title); all.addEventListener('click', () => browse.filter({kind:row.kind || 'Tous',genre:row.genre || ''})); actions.append(all);
    row.items.forEach((item,index) => rail.append(browse.createCard(item,row.ranked ? index+1 : undefined)));
    carousel(section,rail,actions,row.title); root.append(section);
  }
  function renderSagas() {
    if(!data.collections.length) return;
    const {section,actions,rail} = heading('sagas','Les sagas, en grand','DES MONDES À RETROUVER','Entrez dans un univers et retrouvez les films réunis dans une même sélection.');
    for (const collection of data.collections) {
      const titles = data.items.filter(item => item.collection === collection.id); if (!titles.length) continue;
      const card = document.createElement('button'); card.type = 'button'; card.className = 'saga-card'; card.style.setProperty('--saga-color',collection.color);
      card.setAttribute('aria-label','Explorer la saga ' + collection.title);
      const art = make('span','saga-art'); art.setAttribute('aria-hidden','true');
      for (const item of titles.slice(0,3)) {
        if (!item.image || !/^assets\/discovery\/[a-z0-9-]+\.(jpg|png|webp)$/.test(item.image)) continue;
        const img = document.createElement('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.draggable = false; art.append(img);
      }
      const copy = make('span','saga-copy'); copy.append(make('strong','',collection.title),make('span','',titles.length + ' titres à explorer ↗'));
      card.append(art,make('span','saga-shade'),copy); card.addEventListener('click', () => browse.filter({collection:collection.id})); rail.append(card);
    }
    carousel(section,rail,actions,'Les sagas'); root.append(section);
  }
  rows.forEach((row,index) => { renderRow(row); if (index === 2) renderSagas(); });
  const surprise = make('section','discovery-surprise'); const copy = make('div','');
  copy.append(make('p','eyebrow','LAISSEZ LE HASARD CHOISIR'),make('h2','', 'On regarde quoi ce soir ?'),make('p','','Un film, une série, une surprise. Sortez de vos habitudes.'));
  const button = document.createElement('button'); button.type = 'button'; button.className = 'surprise-button'; button.textContent = '✦ Surprends-moi';
  /** @type {string | undefined} */ let lastId;
  button.addEventListener('click', () => {
    const options = data.items.filter(item => item.id !== lastId); const item = options[Math.floor(Math.random() * options.length)];
    if (item) { lastId = item.id; browse.showDetails(item); }
  });
  surprise.append(copy,button); root.append(surprise);
  // Les boutons créés après app.js doivent refléter les favoris dès le premier rendu.
  window.dispatchEvent(new Event('movix-cards-rendered'));
})();
