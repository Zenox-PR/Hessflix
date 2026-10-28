// Contrats et validation partagés, sans interprétation de HTML.
(() => {
  /** @param {string} value */
  function normalise(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  /** @param {unknown} value @returns {value is string} */
  function validPhotoURL(value) {
    return typeof value === 'string' && value.length <= 2048 && (value === '' || /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/.test(value));
  }
  /** Afficher les copies locales des avatars tout en conservant une URL Firebase portable. @param {unknown} value */
  function avatarSource(value) {
    if (!validPhotoURL(value) || !value) return 'assets/avatar-neutral.svg';
    const source = /^https:\/\/raw\.githubusercontent\.com\/movixstream\/MovixOpenSource\/[a-f0-9]{40}\/public\/avatars\/(.+\.png)$/.exec(value);
    if (!source) return value;
    try {
      const parts = source[1].split('/').map(decodeURIComponent);
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\0]/.test(part))) return 'assets/avatar-neutral.svg';
      return 'assets/avatars/' + parts.map(encodeURIComponent).join('/');
    } catch { return 'assets/avatar-neutral.svg'; }
  }
  /** @param {unknown} value @returns {value is import('./types/contracts').Profile} */
  function validProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return 'displayName' in value && typeof value.displayName === 'string' && value.displayName.length >= 1 && value.displayName.length <= 60
      && Object.keys(value).every(key => ['displayName', 'photoURL'].includes(key))
      && (!('photoURL' in value) || validPhotoURL(value.photoURL));
  }
  /** @param {import('./types/contracts').CatalogueItem[]} items @param {import('./types/contracts').BrowseFilter} state */
  function filterItems(items, state) {
    const query = normalise(state.query.trim());
    return items.filter(item => {
      const genres = item.genres || [];
      const kind = state.kind === 'Tous' || item.kind === state.kind || (state.kind === 'Anime' && item.isAnime === true) || (state.kind === 'Animation' && genres.includes('Animation')) || (state.kind === 'Documentaire' && genres.includes('Documentaire'));
      return kind && (!state.genre || genres.includes(state.genre)) && (!state.collection || item.collection === state.collection)
        && normalise(`${item.title} ${item.originalTitle || ''} ${(item.alternativeTitles || []).join(' ')} ${item.kind} ${genres.join(' ')}`).includes(query);
    });
  }
  /** @param {import('./types/contracts').CatalogueItem[]} items @param {import('./types/contracts').Kind} kind */
  function topRated(items, kind) {
    const score = (/** @type {import('./types/contracts').CatalogueItem} */ item) => typeof item.rating === 'string' ? Number(item.rating.replace(',', '.')) || 0 : 0;
    return items.filter(item => item.kind === kind).sort((a, b) => score(b) - score(a) || (b.votes || 0) - (a.votes || 0) || a.title.localeCompare(b.title, 'fr')).slice(0, 10);
  }
  /** @param {unknown} value @returns {value is import('./types/contracts').Availability} */
  function validAvailability(value) {
    if (!value || typeof value !== 'object' || !('platform' in value) || !('country' in value) || !('type' in value) || !('sourceURL' in value) || !('watchURL' in value) || !('checkedAt' in value)) return false;
    const domains = {netflix:'netflix.com','prime-video':'primevideo.com',paramount:'paramountplus.com',disney:'disneyplus.com'};
    if (typeof value.platform !== 'string' || !Object.hasOwn(domains,value.platform) || value.country !== 'FR' || value.type !== 'subscription' || typeof value.sourceURL !== 'string' || !/^https:\/\/www\.justwatch\.com\/fr\/(film|serie)\/[a-z0-9-]+$/.test(value.sourceURL) || typeof value.watchURL !== 'string' || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))) return false;
    try {
      const url=new URL(value.watchURL); const domain=domains[/** @type {keyof typeof domains} */(value.platform)];
      return url.protocol==='https:' && !url.username && !url.password && !url.port && (url.hostname===domain || url.hostname.endsWith('.'+domain));
    } catch {return false;}
  }
  /** Univers choisis par l'admin ; compatibilité avec les anciennes offres vérifiées. @param {import('./types/contracts').CatalogueItem} item @returns {import('./types/contracts').PlatformId[]} */
  function platformsFor(item) {
    const ids=/** @type {import('./types/contracts').PlatformId[]} */(['netflix','prime-video','paramount','disney','marvel']);
    if(Array.isArray(item.platforms))return ids.filter(id=>item.platforms?.includes(id));
    return ids.filter(id=>(id!=='marvel'||item.marvel===true)&&item.availability?.some(offer=>validAvailability(offer)&&offer.platform===(id==='marvel'?'disney':id)));
  }
  /** Limiter les styles de catalogue à des dégradés de couleurs, jamais url(). @param {unknown} value */
  function safePoster(value) {
    return typeof value === 'string' && value.length < 512 && /^(?:linear|radial)-gradient\(/.test(value)
      && /^[a-zA-Z0-9#%.,()\s-]+$/.test(value) && !/url\s*\(/i.test(value) ? value : 'linear-gradient(145deg,#333,#111)';
  }
  const api = { normalise, validPhotoURL, validProfile, filterItems, safePoster, avatarSource, topRated, validAvailability, platformsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MovixModel = api;
})();
