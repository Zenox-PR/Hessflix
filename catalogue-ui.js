// Cartes, fiches et favoris partagés par l’accueil et les univers.
(() => {
  /** @param {import('./types/contracts').CatalogueUIOptions} options */
  function create({dialog,content,notice,onFavoritesChange=()=>{}}) {
    /** @type {Map<string, Set<string>>} */ const favoriteMemory = new Map();
    let noticeTimer = 0;
    dialog.classList.add('discovery-dialog');
/** @param {string} tag @param {string} className @param {string} [text] */
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** @param {import('./types/contracts').CatalogueItem} item */
function mediaId(item) { return item.id || 'demo-' + window.MovixModel.normalise(item.title) + '-' + item.year; }
function favoriteKey() {
  const user = window.MovixAccount?.getUser();
  return 'movix-favorites-v1:' + (user?.uid || 'guest') + ':' + (user?.profileId || 'primary');
}
function favorites() {
  if(window.HessflixPersonal)return new Set(window.HessflixPersonal.favorites());
  const key = favoriteKey();
  if (!favoriteMemory.has(key)) {
    /** @type {string[]} */ let ids = [];
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(stored)) ids = stored.filter((id) => typeof id === 'string' && id.length < 180).slice(0, 250);
    } catch { /* Navigation privée ou stockage indisponible : conserver en mémoire. */ }
    favoriteMemory.set(key, new Set(ids));
  }
  return /** @type {Set<string>} */ (favoriteMemory.get(key));
}
/** @param {string} message */
function announce(message) {
  notice.textContent = message; notice.classList.add('visible');
  clearTimeout(noticeTimer); noticeTimer = window.setTimeout(() => notice.classList.remove('visible'), 4500);
}
function refreshFavoriteButtons() {
  document.querySelectorAll('[data-favorite-id]').forEach(button => {
    if (!(button instanceof HTMLButtonElement)) return;
    const selected = favorites().has(button.dataset.favoriteId || '');
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${selected ? 'Retirer des' : 'Ajouter aux'} favoris : ${button.dataset.title}`);
    button.title = `${selected ? 'Retirer des' : 'Ajouter aux'} favoris de ce profil`;
  });
}
/** @param {import('./types/contracts').CatalogueItem} item */
function favoriteButton(item) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'favorite-button';
  button.dataset.favoriteId = mediaId(item); button.dataset.title = item.title;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z');
  svg.append(path); button.append(svg);
  button.addEventListener('click', async () => {
    const saved = favorites(); const id = mediaId(item); const adding = !saved.has(id);
      if (adding && saved.size >= 500) { announce('Limite de 500 favoris atteinte pour ce profil.'); return; }
    if(window.HessflixPersonal){button.disabled=true;try{await window.HessflixPersonal.setFavorite(id,adding);announce(item.title+(adding?' ajouté aux':' retiré des')+' favoris. '+window.HessflixPersonal.message());refreshFavoriteButtons();onFavoritesChange();}catch(error){announce(error instanceof Error?error.message:'Modification impossible.');}finally{button.disabled=false;}return;}
    if (adding) saved.add(id); else saved.delete(id);
    let persistent = true;
    try { localStorage.setItem(favoriteKey(), JSON.stringify([...saved])); } catch { persistent = false; }
    if(persistent)window.dispatchEvent(new Event('hessflix-favorites-changed'));
    announce(persistent ? `${item.title} ${adding ? 'ajouté aux' : 'retiré des'} favoris sur cet appareil.` : 'Stockage indisponible : choix conservé pour cette visite uniquement.');
    refreshFavoriteButtons(); onFavoritesChange();
  });
  return button;
}
/** @param {import('./types/contracts').CatalogueItem} item */
function posterImage(item) {
  if (!item.image || !(window.HessflixTMDB?.image(item.image) || /^assets\/discovery\/[a-z0-9-]+\.(jpg|png|webp)$/.test(item.image))) return null;
  const img = document.createElement('img'); img.src = item.image; img.alt = ''; img.className = 'poster-image';
  img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false; img.width = 342; img.height = 513;
  img.addEventListener('error', () => { img.closest('.discovery-card')?.classList.remove('has-art'); img.remove(); }); return img;
}
/** @param {import('./types/contracts').CatalogueItem} item */
function showDetails(item) {
  const poster = element('div', 'modal-poster');
  poster.style.setProperty('--poster', window.MovixModel.safePoster(item.poster));
  const image = posterImage(item); if (image) { image.loading = 'eager'; poster.classList.add('with-image'); poster.append(image); }
  const heading=element('h2','',item.title); heading.id=dialog.id==='title-dialog'?'dialog-title':'detail-title'; poster.append(heading);
  dialog.setAttribute('aria-labelledby',heading.id);
  const copy = element('div', 'modal-copy');
  copy.append(element('p', 'eyebrow', `${item.kind.toUpperCase()} · ${item.year} · ★ ${item.rating}`));
  copy.append(element('p', 'detail-summary', item.overview || 'Cette fiche est une donnée fictive du prototype. Aucun flux vidéo n’est chargé.'));
  if (item.genres?.length) copy.append(element('p', 'detail-genres', item.genres.join(' · ')));
  if (item.sourceURL && /^https:\/\/(?:www\.)?(?:imdb\.com|tvmaze\.com|justwatch\.com|themoviedb\.org)\//.test(item.sourceURL)) {
    const source = document.createElement('a'); source.href = item.sourceURL; source.target = '_blank'; source.rel = 'noopener noreferrer';
    const date=item.ratingSource?.includes('JustWatch')?window.MovixPlatformCatalogue?.checkedAt.slice(0,10):window.MovixDiscovery?.updatedAt;
    source.className = 'detail-source'; source.textContent = `Note ${item.ratingSource || ''} : ${item.rating}/10 · relevée le ${date || ''} ↗`;
    copy.append(source, element('p', 'detail-disclaimer', 'Fiche de découverte. Aucune vidéo n’est hébergée ou diffusée ici.'));
  }
  const offers=(item.availability || window.MovixPlatformCatalogue?.items.find(entry=>entry.id===item.id)?.availability || []).filter(window.MovixModel.validAvailability);
  if(offers.length) {
    const available=element('div','detail-availability'); available.append(element('p','', 'Inclus dans l’abonnement · France'));
    for(const offer of offers) {
      const link=document.createElement('a'); link.href=offer.watchURL; link.target='_blank'; link.rel='noopener noreferrer';
      link.className='watch-offer'; link.textContent='Voir sur '+(window.MovixPlatformCatalogue?.providers[offer.platform].name || offer.platform)+' ↗'; available.append(link);
    }
    available.append(element('p','availability-caveat','Relevé du '+new Date(offers[0].checkedAt).toLocaleDateString('fr-FR')+'. Disponibilité et saisons à confirmer sur le service.'));
    copy.append(available);
  }
  const play = element('button', 'primary', item.id ? 'Voir la fiche complète ↗' : 'Continuer à explorer'); play.id = 'modal-play';
  play.addEventListener('click', () => { dialog.close(); if (item.id) window.HessflixTitles.open(item); });
  copy.append(play); content.replaceChildren(poster, copy); dialog.showModal();
}
/** @param {import('./types/contracts').CatalogueItem} item @param {number} [rank] */
function createMediaCard(item, rank) {
  const card = element('article', 'media-card discovery-card' + (item.image ? ' has-art' : '') + (rank ? ' ranked-card' : ''));
  card.dataset.mediaId = mediaId(item); card.dataset.rating = item.rating;
  card.append(element('h3', 'sr-only', item.title));
  const open = document.createElement('button'); open.type = 'button'; open.className = 'card-open';
  open.setAttribute('aria-label', `${rank ? 'Numéro ' + rank + ' : ' : ''}${item.title}, ${item.kind}, ${item.year}, note ${item.rating} sur 10. Ouvrir la fiche`);
  const poster = element('span', 'poster'); poster.dataset.word = item.word || item.title;
  poster.style.setProperty('--poster', window.MovixModel.safePoster(item.poster));
  const image = posterImage(item); if (image) poster.append(image);
  open.append(poster, element('span', 'card-shade'), element('span', 'kind-tag', item.kind));
  if (rank) open.append(element('span', 'rank-number', String(rank)));
  const info = element('span', 'media-info');
  info.append(element('span', 'card-title', item.title));
  const facts = element('span', 'card-facts');
  facts.append(element('span', 'card-rating', '★ ' + item.rating), element('span', 'card-year', '▣ ' + item.year));
  info.append(facts, element('span', 'card-overview', item.overview || 'Découvrez la fiche de cette création du prototype.'));
  open.append(info); open.addEventListener('click', () => window.HessflixTitles.open(item));
  card.append(open, favoriteButton(item)); return card;
}

    let accountWatched = false;
    function watchAccount() {
      if (accountWatched || !window.MovixAccount) return;
      accountWatched=true; window.MovixAccount.subscribe(() => { refreshFavoriteButtons(); onFavoritesChange(); });
    }
    window.addEventListener('movix-auth-status',watchAccount); queueMicrotask(watchAccount);
    window.addEventListener('movix-cards-rendered',refreshFavoriteButtons);
    window.addEventListener('hessflix-personal-changed',()=>{refreshFavoriteButtons();onFavoritesChange();});
    window.addEventListener('hessflix-favorites-changed',()=>{favoriteMemory.clear();refreshFavoriteButtons();onFavoritesChange();});
    window.addEventListener('storage',event => {
      if (event.key?.startsWith('movix-favorites-v1:')) {favoriteMemory.clear();refreshFavoriteButtons();onFavoritesChange();}
    });
    return {createCard:createMediaCard,showDetails,refresh:refreshFavoriteButtons,
      /** @param {import('./types/contracts').CatalogueItem} item */
      isFavorite(item) {return favorites().has(mediaId(item));}};
  }
  window.MovixCatalogueUI = {create};
})();
