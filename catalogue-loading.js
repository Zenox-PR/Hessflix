// Le compte démarre avant le catalogue. Ce message ne dépend d'aucune donnée catalogue.
(() => {
  const script = [...document.scripts].find(element => /(?:^|\/)catalogue-data\.js(?:\?|$)/.test(element.getAttribute('src') || ''));
  if (!script || !document.body) return;

  const notice = document.createElement('aside');
  notice.className = 'catalogue-loading-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const message = document.createElement('span');
  message.textContent = 'Chargement du catalogue… La connexion reste disponible.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'secondary';
  retry.textContent = 'Réessayer';
  retry.hidden = true;
  // Une nouvelle navigation est volontaire : réexécuter app.js créerait des écouteurs en double.
  retry.addEventListener('click', () => location.reload());
  notice.append(message, retry);
  document.body.append(notice);

  const slowTimer = window.setTimeout(() => {
    message.textContent = 'Le catalogue met plus de temps que prévu. Votre connexion au compte reste disponible.';
    retry.hidden = false;
  }, 8000);

  function complete() {
    clearTimeout(slowTimer);
    if (window.HessflixCatalogueStatus === 'ready') {
      notice.hidden = true;
      return;
    }
    // Échouer fermé : aucun ancien cache ou titre non publié n'est rendu à la place.
    window.HessflixCatalogueApproved = true;
    window.HessflixCatalogueStatus = 'unavailable';
    window.MovixDiscovery ||= { updatedAt: '', items: [], collections: [] };
    message.textContent = 'Le catalogue est temporairement indisponible. La connexion au compte fonctionne indépendamment.';
    retry.hidden = false;
  }

  script.addEventListener('load', complete, { once: true });
  script.addEventListener('error', complete, { once: true });
  if (window.HessflixCatalogueStatus) complete();
})();
