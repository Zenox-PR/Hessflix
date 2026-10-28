// Fiches immersives, offres officielles et navigation dans les métadonnées TVMaze.
(async () => {
  /** @typedef {import('./types/contracts').CatalogueItem} Item */
  /** @typedef {import('./types/contracts').Episode} Episode */
  /** @typedef {{season:number,number:number}} Choice */
  /** @template {Element} T @param {string} selector @param {{new():T}} type @returns {T} */
  function required(selector, type) {
    const node = document.querySelector(selector);
    if (!(node instanceof type)) throw new Error('Élément manquant : ' + selector);
    return node;
  }
  /** @param {string} tag @param {string} className @param {string} [value] */
  function make(tag, className, value = '') {
    const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
  }
  /** @param {string} label @param {string} href @param {string} [className] @param {boolean} [external] */
  function link(label, href, className = '', external = false) {
    const anchor = document.createElement('a'); anchor.textContent = label; anchor.href = href; anchor.className = className;
    if (external) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    return anchor;
  }
  /** @param {unknown} value */
  function safeImage(value) {
    return window.HessflixTMDB?.image(value) || (typeof value === 'string' && /^assets\/discovery\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(value) ? value : '');
  }
  /** @param {unknown} value */
  function safeSource(value) {
    return typeof value === 'string' && /^https:\/\/(?:www\.)?(?:imdb\.com|tvmaze\.com|justwatch\.com|themoviedb\.org)\//.test(value);
  }
  /** @param {string} value */
  function rating(value) { const score = Number(value.replace(',', '.')); return Number.isFinite(score) && score > 0 && score <= 10 ? score : 0; }
  /** @param {number} season */
  function seasonLabel(season) { return (season >= 1900 ? 'Année ' : 'Saison ') + season; }
  /** @param {string} date */
  function dateLabel(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    const value = new Date(date + 'T12:00:00Z');
    return Number.isFinite(value.getTime()) ? value.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  async function render() {
    if (!window.MovixDiscovery && !window.MovixPlatformCatalogue && !new URLSearchParams(location.search).get('id')?.startsWith('tmdb-')) throw new Error('Catalogue absent');
    const id = new URLSearchParams(location.search).get('id');
    const items = new Map([...(window.MovixDiscovery?.items || []), ...(window.MovixPlatformCatalogue?.items || [])].map(item => [item.id, item]));
    let entry = id && window.HessflixTitles.validId(id) ? items.get(id) : undefined;
    const note = required('#tmdb-title-note', HTMLElement);
    if (id && window.HessflixTitles.validId(id) && window.HessflixTMDB) {
      try {
        const fresh = await window.HessflixTMDB.detail(id, entry);
        if (fresh) { entry = fresh.item; note.textContent = fresh.stale ? 'TMDB indisponible : dernières informations en cache.' : 'Informations TMDB · ' + (entry.metadataLanguage === 'en-US' ? 'Synopsis en anglais, traduction française indisponible.' : 'Français privilégié.'); }
        else if (id.startsWith('tmdb-')) { entry = window.HessflixTMDB.stored().find(item=>item.id===id); note.textContent = 'Données enregistrées sur cet appareil. TMDB n’est pas configuré.'; }
      } catch {
        if(window.HessflixCatalogueApproved)throw new Error('Ce contenu n’est pas publié ou le catalogue est indisponible.');
        entry ||= window.HessflixTMDB.stored().find(item=>item.id===id);
        note.textContent = 'Informations locales conservées : TMDB est indisponible ou la correspondance n’a pas pu être confirmée.';
        if (!entry) throw new Error('TMDB indisponible');
      }
    }
    note.hidden = !note.textContent;
    if (!entry) { required('#title-not-found', HTMLElement).hidden = false; return; }
    const item = entry;
    const titleId = /** @type {string} */ (id);
    const guide = window.HessflixEpisodes?.shows[titleId];
    const series = item.mediaType === 'tv' || item.kind === 'Série' || !!guide?.episodes?.length;
    const animated = item.kind === 'Animation' || !!item.genres?.includes('Animation');
    const kind = item.isAnime ? (series ? 'Anime · Série' : 'Anime · Film') : series && animated ? 'Série animée' : item.kind;
    const today = new Date().toISOString().slice(0, 10);
    const aired = (guide?.episodes || []).filter(episode => Number.isInteger(episode.season) && episode.season > 0 && Number.isInteger(episode.number) && episode.number > 0 && (!episode.airdate || episode.airdate <= today)).sort((a, b) => a.season - b.season || a.number - b.number);
    const seasons = [...new Set(aired.map(episode => episode.season))];
    const seasonCount = item.tmdbSeasons?.length ? (item.seasonCount ?? item.tmdbSeasons.filter(season=>season.number>0).length) : seasons.length;
    const episodeCount = item.tmdbSeasons?.length ? item.episodeCount : aired.length;
    document.title = item.title + ' — Hessflix';
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute('content', item.title + ' sur Hessflix. ' + (item.overview || 'Présentation et options de visionnage.'));

    const art = required('#title-art', HTMLElement);
    art.style.setProperty('--poster', window.MovixModel.safePoster(item.poster));
    const localImage = safeImage(item.image);
    if (localImage) {
      const image = document.createElement('img'); image.src = localImage; image.alt = 'Affiche de ' + item.title;
      image.width = 342; image.height = 513; image.decoding = 'async'; image.fetchPriority = 'high';
      image.addEventListener('error', () => { image.remove(); art.append(make('span', 'art-fallback', item.title)); if (!safeImage(item.backdrop)) required('#title-backdrop', HTMLElement).style.removeProperty('--backdrop'); });
      art.append(image);
      required('#title-backdrop', HTMLElement).style.setProperty('--backdrop', 'url("' + (safeImage(item.backdrop) || localImage) + '")');
    } else art.append(make('span', 'art-fallback', item.title));
    if (safeImage(item.backdrop)) required('#title-backdrop', HTMLElement).style.setProperty('--backdrop', 'url("' + safeImage(item.backdrop) + '")');
    required('#title-kind', HTMLElement).textContent = kind;
    required('#title-name', HTMLElement).textContent = item.title;
    const overview = required('#title-overview', HTMLElement);
    overview.textContent = item.overview || 'Le synopsis n’est pas encore renseigné pour ce titre.';
    const overviewToggle = required('#overview-toggle', HTMLButtonElement);
    if ((item.overview?.length || 0) > 300) {
      overview.classList.add('is-collapsed'); overviewToggle.hidden = false;
      overviewToggle.addEventListener('click', () => {
        const expanded = overviewToggle.getAttribute('aria-expanded') !== 'true';
        overviewToggle.setAttribute('aria-expanded', String(expanded));
        overview.classList.toggle('is-collapsed', !expanded);
        overviewToggle.textContent = expanded ? 'Réduire le synopsis' : 'Lire la suite';
      });
    }
    const facts = required('#title-facts', HTMLElement);
    if (rating(item.rating)) facts.append(make('span', 'score', '★ ' + item.rating.replace('.', ',') + '/10'));
    if (item.year) facts.append(make('span', '', item.year));
    if (item.runtime) facts.append(make('span', '', item.runtime + ' min'));
    if (seasonCount) facts.append(make('span', '', seasonCount + ' saison' + (seasonCount > 1 ? 's' : '')));
    const genres = required('#title-genres', HTMLElement);
    for (const genre of item.genres || []) genres.append(make('span', '', genre));

    const offers = (item.availability || []).filter(window.MovixModel.validAvailability);
    const distinct = [...new Map(offers.map(offer => [offer.platform, offer])).values()];
    const services = window.MovixPlatformCatalogue?.providers;
    const watch = required('#watch-options', HTMLElement);
    const actions = required('#title-actions', HTMLElement);
    if (distinct.length) {
      const first = distinct[0]; const name = services?.[first.platform]?.name || first.platform;
      actions.append(link('Regarder sur ' + name + ' ↗', first.watchURL, 'title-primary', true));
      required('#title-watch-hint', HTMLElement).textContent = 'Ouvre le service officiel · Abonnement du service requis';
      required('#watch-intro', HTMLElement).textContent = 'Les services suivants figurent dans notre relevé des offres incluses avec abonnement en France.';
      for (const offer of distinct) watch.append(link('Regarder sur ' + (services?.[offer.platform]?.name || offer.platform) + ' ↗', offer.watchURL, '', true));
      required('#watch-caveat', HTMLElement).textContent = 'Relevé du ' + new Date(first.checkedAt).toLocaleDateString('fr-FR') + '. Les abonnements, saisons et épisodes peuvent changer ; vérifiez le service avant de payer.';
    } else {
      const search = 'https://www.justwatch.com/fr/recherche?q=' + encodeURIComponent(item.title);
      actions.append(link('Trouver où regarder ↗', search, 'title-primary', true));
      watch.append(link('Chercher où regarder ↗', search, '', true));
      required('#title-watch-hint', HTMLElement).textContent = 'Consultez la disponibilité actuelle de ce titre.';
      required('#watch-intro', HTMLElement).textContent = 'Aucune offre d’abonnement n’a été vérifiée pour ce titre dans notre sélection.';
      required('#watch-caveat', HTMLElement).textContent = 'La recherche de disponibilité peut également proposer location ou achat.';
    }
    actions.append(link(series ? 'Choisir un épisode ↓' : 'Les détails ↓', series ? '#episode-section' : '#about-title', 'title-secondary'));
    window.HessflixTitleVideo?.mount(item, series);
    window.HessflixActivity?.mountTitle(item,series);
    const metadata = required('#title-metadata', HTMLElement);
    const details = [['Année', item.year], ['Type', kind], ['Note', rating(item.rating) ? item.rating.replace('.', ',') + '/10' : 'Non renseignée'], ['Source de la note', item.ratingSource || 'Non renseignée'], ['Genres', item.genres?.join(', ') || 'Non renseignés']];
    if (item.releaseDate) details.push(['Première sortie / diffusion', dateLabel(item.releaseDate)]);
    if (item.runtime) details.push(['Durée', item.runtime + ' min']);
    if (item.tmdbId) details.push(['Identifiant TMDB', item.mediaType + ' / ' + item.tmdbId]);
    if (item.originalTitle && item.originalTitle !== item.title) details.push(['Titre original', item.originalTitle]);
    if (item.alternativeTitles?.length) details.push(['Autres titres', item.alternativeTitles.slice(0, 8).join(' · ')]);
    if (seasonCount) details.push(['Saisons répertoriées', String(seasonCount)]);
    if (episodeCount) details.push(['Épisodes répertoriés', String(episodeCount)]);
    for (const [label, value] of details) metadata.append(make('dt', '', label), make('dd', '', value || 'Non renseigné'));
    const sources = required('#title-sources', HTMLElement);
    if (safeSource(item.sourceURL)) sources.append(link('Source de la fiche ↗', /** @type {string} */(item.sourceURL), '', true));
    if (distinct.length) sources.append(link('Disponibilité en France ↗', distinct[0].sourceURL, '', true));

    if (series) {
      required('#episode-section', HTMLElement).hidden = false;
      required('#episode-jump', HTMLElement).hidden = false;
      if (item.tmdbId && item.tmdbSeasons?.length && window.HessflixTMDBEpisodes) {
        window.HessflixTMDBEpisodes.mount(item, titleId);
        sources.append(link('Épisodes : TMDB ↗', 'https://www.themoviedb.org/tv/' + item.tmdbId + '/seasons', '', true));
      } else {
      if (guide && safeSource(guide.sourceURL)) sources.append(link('Épisodes : TVMaze ↗', guide.sourceURL, '', true));
      const summary = required('#episode-summary', HTMLElement);
      if (!aired.length) {
        const message = guide?.episodes?.length ? 'Aucun épisode diffusé n’est répertorié pour le moment.' : 'Le guide des épisodes n’est pas encore disponible pour cette série.';
        summary.textContent = message; required('#episode-empty', HTMLElement).textContent = 'Les saisons et les épisodes apparaîtront ici lorsque leurs informations seront disponibles.';
        required('#episode-empty', HTMLElement).hidden = false;
        required('#episode-toolbar', HTMLElement).hidden = true;
        required('#season-strip', HTMLElement).hidden = true;
        required('#episode-selected', HTMLElement).hidden = true;
      } else {
        summary.textContent = seasons.length + ' saison' + (seasons.length > 1 ? 's' : '') + ' · ' + aired.length + ' épisodes répertoriés';
        setupEpisodes(titleId, aired, seasons);
      }
      }
    }

    const related = [...items.values()].filter(candidate => candidate.id !== item.id && window.HessflixTitles.validId(candidate.id) && candidate.kind === item.kind && candidate.genres?.some(genre => item.genres?.includes(genre)))
      .sort((a, b) => {
        const relevance = (/** @type {Item} */ candidate) => (candidate.collection && candidate.collection === item.collection ? 10 : 0) + (candidate.genres || []).filter(genre => item.genres?.includes(genre)).length;
        return relevance(b) - relevance(a) || rating(b.rating) - rating(a.rating) || a.title.localeCompare(b.title, 'fr');
      }).slice(0, 6);
    if (related.length) {
      required('#related-section', HTMLElement).hidden = false;
      required('#related-jump', HTMLElement).hidden = false;
      const list = required('#related-list', HTMLElement);
      for (const candidate of related) {
        const card = link('', 'titre.html?id=' + encodeURIComponent(candidate.id || ''), 'related-card');
        card.setAttribute('aria-label', 'Découvrir ' + candidate.title);
        const imagePath = safeImage(candidate.image);
        const visual = make('div', 'related-art');
        visual.style.setProperty('--poster', window.MovixModel.safePoster(candidate.poster));
        if (imagePath) {
          const image = document.createElement('img'); image.src = imagePath; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.width = 342; image.height = 513;
          image.addEventListener('error', () => image.remove()); visual.append(image);
        }
        visual.append(make('span', 'related-kind', candidate.kind));
        const caption = make('div', 'related-caption');
        caption.append(make('h3', '', candidate.title), make('p', '', candidate.year + (rating(candidate.rating) ? ' · ★ ' + candidate.rating.replace('.', ',') : '')));
        card.append(visual, caption); list.append(card);
      }
    }
    required('#title-content', HTMLElement).hidden = false;
    const remember = () => window.HessflixTitles.remember(item.id);
    remember(); window.addEventListener('movix-auth-status', remember, { once: true });
  }

  /** @param {string} titleId @param {Episode[]} aired @param {number[]} seasons */
  function setupEpisodes(titleId, aired, seasons) {
    const list = required('#episode-list', HTMLElement);
    const seasonSelect = required('#season-select', HTMLSelectElement);
    const episodeSelect = required('#episode-select', HTMLSelectElement);
    const selected = required('#episode-selected', HTMLElement);
    const strip = required('#season-strip', HTMLElement);
    const previous = required('#episode-prev', HTMLButtonElement);
    const next = required('#episode-next', HTMLButtonElement);
    const choiceKey = () => { const user = window.MovixAccount?.getUser(); return 'hessflix-episode-choice-v1:' + (user?.uid || 'guest') + ':' + (user?.profileId || 'primary') + ':' + titleId; };
    let activeChoiceKey = choiceKey();
    /** @type {Choice|null} */ let choice = null;
    /** @param {string} key @returns {Choice|null} */
    function readChoice(key) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value && Number.isInteger(value.season) && Number.isInteger(value.number) ? { season: value.season, number: value.number } : null;
      } catch { return null; }
    }
    function restore() {
      const remote=window.HessflixPersonal?.selection(titleId);
      const saved = remote?{season:remote.season,number:remote.episode}:readChoice(activeChoiceKey);
      const episode = aired.find(candidate => candidate.season === saved?.season && candidate.number === saved.number) || aired[0];
      choice = { season: episode.season, number: episode.number };
      seasonSelect.value = String(episode.season);
    }
    function refreshSelection() {
      const current = aired.find(episode => episode.season === choice?.season && episode.number === choice?.number);
      if (!current) return;
      const currentIndex = aired.indexOf(current);
      previous.disabled = currentIndex === 0; next.disabled = currentIndex === aired.length - 1;
      episodeSelect.value = String(current.number);
      selected.textContent = seasonLabel(current.season) + ', épisode ' + current.number + ' : ' + current.title + '. Ouvrez le service officiel et choisissez cet épisode.';
      list.querySelectorAll('button').forEach(button => {
        const active = Number(button.dataset.number) === current.number;
        button.setAttribute('aria-pressed', String(active));
        const badge = button.querySelector('.episode-badge');
        if (badge instanceof HTMLElement) badge.hidden = !active;
      });
      strip.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.season) === current.season)));
      window.dispatchEvent(new CustomEvent('hessflix-episode-selected', { detail: { ready: true, season: current.season, episode: current.number } }));
    }
    function renderSeason() {
      const season = Number(seasonSelect.value);
      const episodes = aired.filter(episode => episode.season === season);
      list.replaceChildren(); episodeSelect.replaceChildren();
      for (const episode of episodes) {
        const option = document.createElement('option'); option.value = String(episode.number); option.textContent = episode.number + '. ' + episode.title; episodeSelect.append(option);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'episode-card'; button.dataset.number = String(episode.number);
        button.setAttribute('aria-label', seasonLabel(season) + ', épisode ' + episode.number + ' : ' + episode.title);
        const visual = make('span', 'episode-art');
        visual.append(make('span', 'episode-art-label', 'ÉPISODE'), make('strong', '', String(episode.number).padStart(2, '0')));
        const badge = make('span', 'episode-badge', '✓ Sélectionné'); badge.hidden = true; visual.append(badge);
        const copy = make('span', 'episode-copy');
        copy.append(make('strong', '', episode.number + '. ' + episode.title));
        const details = [dateLabel(episode.airdate), episode.runtime ? episode.runtime + ' min' : ''].filter(Boolean).join(' · ');
        if (details) copy.append(make('small', '', details));
        button.append(visual, copy);
        button.addEventListener('click', () => choose(episode));
        list.append(button);
      }
      refreshSelection();
    }
    /** @param {Episode} episode */
    function choose(episode,persist=true) {
      const changedSeason = Number(seasonSelect.value) !== episode.season;
      choice = { season: episode.season, number: episode.number };
      seasonSelect.value = String(episode.season);
      if(persist){try { localStorage.setItem(activeChoiceKey, JSON.stringify(choice)); } catch {}void window.HessflixPersonal?.saveSelection(titleId,{season:episode.season,episode:episode.number}).catch(error=>{required('#episode-selected',HTMLElement).textContent='La sélection n’a pas été synchronisée : '+(error instanceof Error?error.message:'réessayez.');});}
      if (changedSeason) renderSeason(); else refreshSelection();
    }
    for (const season of seasons) {
      const episodes = aired.filter(episode => episode.season === season);
      const option = document.createElement('option'); option.value = String(season); option.textContent = seasonLabel(season); seasonSelect.append(option);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'season-tab'; button.dataset.season = String(season);
      button.setAttribute('aria-controls', 'episode-list');
      button.append(make('strong', '', seasonLabel(season)), make('span', '', episodes.length + ' épisodes'));
      button.addEventListener('click', () => choose(episodes[0]));
      strip.append(button);
    }
    restore(); renderSeason();
    window.addEventListener('hessflix-personal-changed',()=>{const saved=window.HessflixPersonal?.selection(titleId);const episode=saved&&aired.find(value=>value.season===saved.season&&value.number===saved.episode);if(episode&&(choice?.season!==episode.season||choice?.number!==episode.number))choose(episode,false);});
    seasonSelect.addEventListener('change', () => {
      const first = aired.find(episode => episode.season === Number(seasonSelect.value));
      if (first) { choose(first); renderSeason(); }
    });
    episodeSelect.addEventListener('change', () => {
      const episode = aired.find(candidate => candidate.season === Number(seasonSelect.value) && candidate.number === Number(episodeSelect.value));
      if (episode) choose(episode);
    });
    /** @param {number} delta */
    function shift(delta) {
      const index = aired.findIndex(episode => episode.season === choice?.season && episode.number === choice?.number);
      const episode = aired[index + delta]; if (index >= 0 && episode) choose(episode);
    }
    previous.addEventListener('click', () => shift(-1)); next.addEventListener('click', () => shift(1));
    window.MovixAccount?.subscribe(() => {
      const key = choiceKey(); if (key === activeChoiceKey) return;
      activeChoiceKey = key; restore(); renderSeason();
    });
  }

  try { await render(); }
  catch {
    required('#title-content', HTMLElement).hidden = true;
    required('#title-not-found', HTMLElement).hidden = false;
    required('#title-error-heading', HTMLElement).textContent = 'Cette fiche n’a pas pu être chargée.';
    required('#title-error-description', HTMLElement).textContent = 'Réessayez dans un instant ou retrouvez les autres sélections.';
    required('#title-reload', HTMLButtonElement).hidden = false;
  } finally { required('#title-loading', HTMLElement).hidden = true; }
  required('#title-reload', HTMLButtonElement).addEventListener('click', () => location.reload());
})();
