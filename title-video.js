(() => {
  /** @param {import('./types/contracts').CatalogueItem} item @param {boolean} series */
  function mount(item, series) {
    const section = document.getElementById('video-section');
    const root = document.getElementById('video-mount');
    const controls = document.getElementById('video-controls');
    const label = document.getElementById('video-selection');
    if (!section || !root || !controls || !label || !window.HessflixVideoPlayer) return;
    const selectedLabel = label;
    section.hidden = false;
    const player = window.HessflixVideoPlayer.create(root);
    const watch = document.createElement('button'); watch.type = 'button'; watch.className = 'title-primary'; watch.textContent = 'Regarder'; watch.hidden = true;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'title-secondary'; retry.textContent = 'Réessayer'; retry.hidden = true;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'title-secondary'; close.textContent = 'Fermer le lecteur'; close.hidden = true;
    controls.append(watch, retry, close);
    /** @type {{season:number;episode:number}|null} */ let selection = null;
    /** @type {AbortController|null} */ let controller = null;
    let sequence = 0, opened = false, currentURL = '', disposed = false;
    const id = item.catalogueId || item.id || '';
    /** @param {boolean} [force] */
    async function refresh(force = false) {
      const ticket = ++sequence;
      controller?.abort(); const activeController = new AbortController(); controller = activeController;
      if (series && !selection) { watch.hidden = true; player.clear('Choisissez un épisode publié pour vérifier sa vidéo.'); return; }
      const suffix = selection ? '?' + new URLSearchParams({ season: String(selection.season), episode: String(selection.episode) }) : '';
      const timeout = window.setTimeout(() => activeController.abort(), 12000);
      try {
        const response = await fetch('/api/catalogue/' + encodeURIComponent(id) + '/playback' + suffix, { cache: 'no-store', signal: activeController.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'Ce contenu ou cet épisode n’est plus publié.' : 'La vidéo ne peut pas être vérifiée pour le moment.');
        const result = /** @type {{available:boolean;embedURL?:string}} */ (await response.json());
        if (ticket !== sequence || disposed) return;
        retry.hidden = false;
        const available = result.available === true && window.HessflixVideoPlayer?.valid(result.embedURL);
        watch.hidden = !available;
        if (!available) { currentURL = ''; close.hidden = true; player.clear('Aucune vidéo n’est disponible pour ' + (series ? 'cet épisode.' : 'ce film.')); return; }
        const url = /** @type {string} */ (result.embedURL);
        if (opened && (force || currentURL !== url)) player.show(url, item.title + (selection ? ' — S' + selection.season + ' E' + selection.episode : ''));
        if (!opened) player.clear('Une vidéo est configurée. Cliquez sur « Regarder » pour contacter Vidmoly et ouvrir son lecteur.');
        currentURL = url; close.hidden = !opened;
      } catch (error) {
        if (ticket !== sequence || disposed) return;
        watch.hidden = true; close.hidden = true; retry.hidden = false; currentURL = '';
        player.clear(error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError) ? error.message : 'La vidéo ne peut pas être vérifiée. Vérifiez votre connexion puis réessayez.');
      } finally { clearTimeout(timeout); }
    }
    watch.addEventListener('click', () => { opened = true; void refresh(true); section.scrollIntoView({ block: 'start' }); });
    retry.addEventListener('click', () => { void refresh(true); });
    close.addEventListener('click', () => { opened = false; close.hidden = true; player.clear('Lecteur fermé. Vous pouvez le rouvrir avec « Regarder ».'); });
    /** @param {Event} event */
    function selected(event) {
      if (!series) return;
      const detail = event instanceof CustomEvent ? event.detail : null;
      sequence++; controller?.abort(); currentURL = ''; player.clear('Vérification de la vidéo de l’épisode…'); watch.hidden = true; close.hidden = true;
      if (!detail?.ready || !Number.isSafeInteger(detail.season) || detail.season < 0 || !Number.isSafeInteger(detail.episode) || detail.episode < 1) { selection = null; return; }
      selection = { season: detail.season, episode: detail.episode };
      selectedLabel.textContent = 'Saison ' + selection.season + ' · Épisode ' + selection.episode;
      void refresh();
    }
    window.addEventListener('hessflix-episode-selected', selected);
    const poll = window.setInterval(() => { if (!document.hidden && (opened || currentURL) && !disposed) void refresh(); }, 30000);
    window.addEventListener('pagehide', () => { disposed = true; sequence++; controller?.abort(); clearInterval(poll); player.clear(); window.removeEventListener('hessflix-episode-selected', selected); }, { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    label.textContent = series ? 'Choisissez un épisode ci-dessous.' : item.title;
    void refresh();
  }
  window.HessflixTitleVideo = { mount };
})();
