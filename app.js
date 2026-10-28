const items = [...new Map([...(window.HessflixTMDB?.stored() || []), ...(window.MovixDiscovery?.items || []), ...(window.MovixPlatformCatalogue?.items || [])].map(item => [item.id,item])).values()];
const byId = new Map(items.map(item => [item.id, item]));
const suggestedIds = ['series-2993', 'movie-tt0816692', 'series-55138', 'movie-tt0499549'];
/** @template {Element} T @param {string} selector @param {{new():T}} type @returns {T} */
function required(selector, type) {
  const value = document.querySelector(selector);
  if (!(value instanceof type)) throw new Error('Élément manquant : ' + selector);
  return value;
}
const catalogue = required('#catalogue-cards', HTMLElement);
const continued = required('#continue-cards', HTMLElement);
const count = required('#result-count', HTMLElement);
const dialog = required('#details-modal', HTMLDialogElement);
const content = required('#modal-content', HTMLElement);
const search = required('#search', HTMLInputElement);
/** @type {import('./types/contracts').BrowseFilter} */
const state = { query: '', kind: 'Tous', genre: '', collection: '', favorites: false };
/** @param {string} tag @param {string} className @param {string} [text] */
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const catalogueUI = window.MovixCatalogueUI.create({dialog,content,notice:required('#discovery-notice',HTMLElement),onFavoritesChange() { if(state.favorites) refreshCatalogue(); }});
/** @param {import('./types/contracts').CatalogueItem} item */
function showDetails(item) {catalogueUI.showDetails(item);}
/** @param {import('./types/contracts').CatalogueItem} item @param {number} [rank] */
function createMediaCard(item,rank) {return catalogueUI.createCard(item,rank);}
function refreshFavoriteButtons() {
  catalogueUI.refresh(); document.querySelectorAll('[data-local-favorites]').forEach(button=>button.setAttribute('aria-pressed',String(!!state.favorites)));
}
/** @param {import('./types/contracts').CatalogueItem[]} list */
function renderCatalogue(list) {
  catalogue.replaceChildren(...list.map(item => createMediaCard(item)));
  count.textContent = `${list.length} résultat${list.length > 1 ? 's' : ''}`;
  required('#catalogue-empty', HTMLElement).hidden = list.length > 0;
  refreshFavoriteButtons();
}
function refreshCatalogue() {
  window.dispatchEvent(new CustomEvent('hessflix-filter', {detail:{...state}}));
  const filtering = !!(state.query.trim() || state.kind !== 'Tous' || state.genre || state.collection || state.favorites);
  required('#resultats', HTMLElement).hidden = !filtering;
  required('#discovery-sections', HTMLElement).hidden = filtering;
  if (!filtering) { catalogue.replaceChildren(); count.textContent = ''; return; }
  const available = [...new Map([...items, ...(window.HessflixTMDB?.stored() || [])].map(item=>[item.id,item])).values()];
  let list = window.MovixModel.filterItems(available, state);
  if (state.favorites) list = list.filter(item => catalogueUI.isFavorite(item));
  renderCatalogue(list);
}
/** @param {Partial<import('./types/contracts').BrowseFilter>} options */
function applyDiscoveryFilter(options) {
  Object.assign(state, { query: '', kind: 'Tous', genre: '', collection: '', favorites: false }, options);
  search.value = state.query;
  document.querySelectorAll('[data-filter]').forEach(button => {
    const selected = button instanceof HTMLElement && button.dataset.filter === state.kind;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  const collection = window.MovixDiscovery?.collections.find(value => value.id === state.collection);
  required('#catalogue-selection', HTMLElement).textContent = collection?.title || state.genre || (state.favorites ? 'Mes favoris de ce profil' : state.query ? 'Résultats de recherche' : state.kind === 'Tous' ? 'À découvrir' : state.kind + 's à découvrir');
  refreshCatalogue();
  required(state.kind === 'Tous' && !state.query && !state.genre && !state.collection && !state.favorites ? '#suggestions-demo' : '#resultats', HTMLElement).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
let continueSignature='';
function renderContinue() {
  const recentIds = window.HessflixTitles.recent();
  const progress=window.HessflixActivity?.snapshot().progress.filter(item=>item.status==='in-progress')||[];
  const resumeIds=progress.map(item=>item.id).filter(id=>byId.has(id));
  const chosenIds = [...new Set([...resumeIds,...recentIds, ...suggestedIds, ...items.map(item=>item.id||'')])].filter(id=>byId.has(id)).slice(0, 4);
  const continueItems = chosenIds.map(id => byId.get(id)).filter((item) => !!item);
  const signature=JSON.stringify([resumeIds,recentIds,chosenIds]);if(signature===continueSignature)return;continueSignature=signature;
  required('#continue-hint', HTMLElement).textContent = resumeIds.length?'Vos titres en cours pour ce profil':recentIds.length ? 'Vos fiches ouvertes récemment' : 'Quelques idées pour commencer';
  continued.replaceChildren(...continueItems.map(item => {
    const card = element('button', 'continue-card'); card.style.setProperty('--card', window.MovixModel.safePoster(item.poster));
    if (item.image && (window.HessflixTMDB?.image(item.image) || /^assets\/discovery\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(item.image))) {
      const image = document.createElement('img'); image.src = item.image; image.alt = ''; image.loading = 'lazy'; card.append(image);
    }
    const label = element('span', 'continue-copy'); label.append(element('span', 'continue-type', item.kind), element('h3', '', item.title), element('p', '', resumeIds.includes(item.id||'')?'Reprendre sur la fiche ↗':recentIds.includes(item.id || '') ? 'Revoir la fiche ↗' : 'Découvrir la fiche ↗'));
    card.append(label); card.addEventListener('click', () => window.HessflixTitles.open(item)); return card;
  }));
}
search.addEventListener('input', () => { state.query = search.value; refreshCatalogue(); });
search.setAttribute('aria-label', 'Rechercher un film, une série ou un anime');
search.setAttribute('aria-controls', 'resultats');
search.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); state.query = search.value; refreshCatalogue(); required('#resultats', HTMLElement).scrollIntoView({ behavior: 'instant', block: 'start' }); }
  if (event.key === 'Escape') { search.value = ''; state.query = ''; refreshCatalogue(); }
});
document.querySelectorAll('[data-filter]').forEach(node => {
  if (!(node instanceof HTMLButtonElement)) return;
  node.addEventListener('click', () => {
    const kind = node.dataset.filter || 'Tous';
    applyDiscoveryFilter(kind === 'Tous' ? {} : { kind, query: search.value });
  });
});
// La bannière se charge indépendamment dans hero.js ; le catalogue ne la réécrit pas.
document.querySelectorAll('[data-nav-kind]').forEach(node => node.addEventListener('click', event => { event.preventDefault(); if (node instanceof HTMLElement) applyDiscoveryFilter({ kind: node.dataset.navKind || 'Tous' }); }));
document.querySelectorAll('[data-local-favorites]').forEach(button => button.addEventListener('click', () => applyDiscoveryFilter({ favorites: !state.favorites })));
required('#close-modal', HTMLElement).addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
renderContinue(); refreshCatalogue();
let watchingRecentAccount = false;
window.addEventListener('movix-auth-status', () => {
  renderContinue();
  if (!watchingRecentAccount && window.MovixAccount) { watchingRecentAccount = true; window.MovixAccount.subscribe(renderContinue); }
});
window.addEventListener('storage', event => { if (event.key?.startsWith('hessflix-recent-v1:')) renderContinue(); });
window.addEventListener('hessflix-activity-changed',renderContinue);
window.MovixBrowse = { items: window.MovixDiscovery?.items || [], createCard: createMediaCard, showDetails, filter: applyDiscoveryFilter };
const profileCategory=new URLSearchParams(location.search).get('categorie');
if(profileCategory&&['Film','Série','Anime'].includes(profileCategory))window.addEventListener('DOMContentLoaded',()=>applyDiscoveryFilter({kind:profileCategory}),{once:true});
