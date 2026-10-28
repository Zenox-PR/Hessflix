// Navigation vers les fiches et historique local des fiches ouvertes.
(() => {
  /** @param {unknown} id @returns {id is string} */
  const validId = id => typeof id === 'string' && id.length < 80 && /^(?:movie-tt\d+|series-\d+|jw-(?:tm|ts)\d+|tmdb-(?:movie|tv)-[1-9]\d{0,8})$/.test(id);
  const key = () => {
    const user = window.MovixAccount?.getUser();
    return 'hessflix-recent-v1:' + (user?.uid || 'guest') + ':' + (user?.profileId || 'primary');
  };
  function recent() {
    try {
      const value = JSON.parse(localStorage.getItem(key()) || '[]');
      return Array.isArray(value) ? value.filter(validId).slice(0, 20) : [];
    } catch { return []; }
  }
  /** @param {string | undefined} id */
  function remember(id) {
    if (!validId(id)) return;
    try { localStorage.setItem(key(), JSON.stringify([id, ...recent().filter(value => value !== id)].slice(0, 20))); }
    catch { /* L'historique reste facultatif en navigation privée. */ }
  }
  /** @param {import('./types/contracts').CatalogueItem} item */
  function open(item) {
    if (!validId(item?.id)) return;
    window.HessflixTMDB?.remember(item);
    remember(item.id);
    window.location.assign('titre.html?id=' + encodeURIComponent(item.id));
  }
  window.HessflixTitles = { open, recent, remember, validId };
})();
