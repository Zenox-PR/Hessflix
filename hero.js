// Image, texte et destinations sont validés comme une seule diapositive.
(() => {
  const mounted = new WeakMap();
  const validId = value => typeof value === 'string' && value.length <= 64 &&
    /^(tmdb-(movie|tv)-[1-9]\d{0,8}|movie-tt\d+|series-\d+|jw-(tm|ts)\d+)$/.test(value);
  const safeImage = value => typeof value === 'string' && (
    /^https:\/\/image\.tmdb\.org\/t\/p\/(w500|w780|w1280)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value) ||
    /^assets\/discovery\/[a-z0-9-]+\.(jpg|png|webp)$/.test(value)
  );

  function make(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function mount(root, { preview = false, items: initialItems = [] } = {}) {
    mounted.get(root)?.destroy();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let items = [], current = -1, desired = 0, generation = 0;
    let autoplay = !preview && !reduced.matches, timer = 0, inView = true, hovering = false, focusing = false;
    let disposed = false, slideSignature = '', currentImage = null, imageTask = null, remoteLoading = false;

    root.classList.add('cinematic-hero');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carrousel');
    root.setAttribute('aria-label', preview ? 'Prévisualisation privée de la bannière' : 'Sélection Hessflix');
    root.replaceChildren();

    const artwork = make('div', 'hero-artwork');
    artwork.setAttribute('aria-hidden', 'true');
    const fallback = make('div', 'hero-art-fallback');
    fallback.append(make('span', 'hero-monogram', 'H'), make('span', 'hero-fallback-caption', 'HESSFLIX · VOS PROCHAINES HISTOIRES'));
    const photo = make('div', 'hero-photo');
    artwork.append(fallback, photo);
    const copy = make('div', 'hero-copy');
    const eyebrow = make('p', 'eyebrow', preview ? 'APERÇU PRIVÉ · NON PUBLIÉ' : 'LA SÉLECTION HESSFLIX');
    const facts = make('div', 'hero-facts');
    const title = make(preview ? 'h3' : 'h1', 'hero-heading', 'Votre prochaine histoire vous attend.');
    const description = make('p', 'hero-description', 'Des films, des séries, des univers à découvrir.');
    const actions = make('div', 'hero-actions');
    const info = make('a', 'secondary', 'Plus d’infos');
    const watch = make('a', 'primary', '▶  Où regarder');
    if (!preview) { info.id = 'hero-info'; watch.id = 'hero-play'; }
    info.hidden = watch.hidden = true;
    watch.target = '_blank';
    watch.rel = 'noopener noreferrer';
    if (preview) {
      for (const action of [info, watch]) {
        action.tabIndex = -1;
        action.setAttribute('role', 'link');
        action.setAttribute('aria-disabled', 'true');
      }
    }
    actions.append(watch, info);
    copy.append(eyebrow, facts, title, description, actions);

    const footer = make('div', 'hero-bottom');
    const caption = make('p', 'hero-editorial-note', 'CHOISI POUR VOUS. PAS PAR UN ALGORITHME.');
    const controls = make('div', 'hero-controls');
    const previous = make('button', 'hero-arrow', '←');
    const next = make('button', 'hero-arrow', '→');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', 'Titre précédent');
    next.setAttribute('aria-label', 'Titre suivant');
    const indicators = make('div', 'hero-indicators');
    indicators.setAttribute('role', 'group');
    indicators.setAttribute('aria-label', 'Choisir un titre');
    const count = make('span', 'hero-position');
    const pause = make('button', 'hero-pause');
    pause.type = 'button';
    controls.append(previous, indicators, next, count, pause);
    footer.append(caption, controls);
    const status = make('p', 'hero-load-status');
    status.setAttribute('role', 'status');
    const retry = make('button', 'hero-retry secondary', 'Réessayer');
    retry.type = 'button';
    retry.hidden = true;
    root.append(artwork, copy, footer, status, retry);

    function busyState() {
      root.setAttribute('aria-busy', String(remoteLoading || Boolean(imageTask)));
    }

    function stopTimer() { clearTimeout(timer); timer = 0; }

    function schedule() {
      stopTimer();
      if (!disposed && autoplay && !reduced.matches && !document.hidden && inView &&
          !hovering && !focusing && !imageTask && items.length > 1 && current >= 0) {
        timer = setTimeout(() => { void select((current + 1) % items.length); }, 8500);
      }
    }

    function controlsState() {
      previous.disabled = next.disabled = items.length < 2;
      controls.hidden = items.length === 0;
      pause.hidden = items.length < 2 || reduced.matches || preview;
      pause.textContent = autoplay ? 'Ⅱ' : '▶';
      pause.setAttribute('aria-label', autoplay ? 'Mettre le défilement en pause' : 'Activer le défilement');
      pause.setAttribute('aria-pressed', String(!autoplay));
      count.textContent = items.length ? String(current + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0') : '';
      indicators.querySelectorAll('button').forEach((button, index) => {
        button.setAttribute('aria-current', index === current ? 'true' : 'false');
      });
    }

    function destination(item) {
      return Array.isArray(item.availability)
        ? item.availability.find(value => window.MovixModel?.validAvailability(value))?.watchURL || '' : '';
    }

    function cancelImage() {
      imageTask?.cancel();
      imageTask = null;
    }

    function prepareImage(item, priority) {
      const source = safeImage(item.heroBackdrop) ? item.heroBackdrop : safeImage(item.backdrop) ? item.backdrop : '';
      if (!source) return null;
      const image = new Image();
      image.alt = '';
      image.width = 1920;
      image.height = 1080;
      image.decoding = 'async';
      image.loading = 'eager';
      image.fetchPriority = priority;
      if (/\/w1280\//.test(source)) {
        image.srcset = source.replace('/w1280/', '/w500/') + ' 500w, ' + source.replace('/w1280/', '/w780/') + ' 780w, ' + source + ' 1280w';
        image.sizes = '(max-width: 700px) 100vw, min(1280px, 100vw)';
      }
      let finish, timeout, finished = false;
      const promise = new Promise(resolve => {
        finish = value => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          image.onload = image.onerror = null;
          if (!value) {
            image.removeAttribute('srcset');
            image.removeAttribute('src');
          }
          resolve(value);
        };
        timeout = setTimeout(() => finish(null), 8000);
        image.onload = () => finish(image);
        image.onerror = () => finish(null);
        image.src = source;
      });
      return { promise, cancel: () => finish(null) };
    }

    function renderSlide(item, target, image) {
      // No old artwork can remain behind a newly selected title or destination.
      photo.replaceChildren(...(image ? [image] : []));
      currentImage = image;
      root.classList.toggle('has-artwork', Boolean(image));
      root.classList.toggle('hero-long-title', item.title.length > 45);
      title.textContent = item.title;
      title.title = item.title;
      const overview = typeof item.overview === 'string' ? item.overview : '';
      description.textContent = !overview ? 'Synopsis non renseigné.' : overview.length > 280
        ? overview.slice(0, 280).replace(/\s+\S*$/, '') + '…' : overview;
      facts.replaceChildren();
      const kind = item.isAnime ? 'Anime' : item.kind;
      if (typeof kind === 'string' && kind) facts.append(make('span', 'hero-type', kind));
      if (/^\d{4}$/.test(String(item.year || ''))) facts.append(make('span', '', String(item.year)));
      const rawRating = typeof item.rating === 'number' ? String(item.rating) : item.rating;
      const rating = typeof rawRating === 'string' && rawRating.trim() ? Number(rawRating.replace(',', '.')) : NaN;
      if (Number.isFinite(rating) && rating >= 0 && rating <= 10) facts.append(make('span', 'hero-rating', '★ ' + rawRating));

      info.hidden = false;
      const watchURL = destination(item);
      watch.hidden = !watchURL;
      if (!preview) {
        info.href = '/titre.html?id=' + encodeURIComponent(item.id);
        if (watchURL) watch.href = watchURL;
        else watch.removeAttribute('href');
      } else {
        info.removeAttribute('href');
        watch.removeAttribute('href');
      }
      current = target;
      controlsState();
    }

    async function select(index) {
      if (!items.length || disposed) return;
      desired = (index + items.length) % items.length;
      const ticket = ++generation;
      const item = items[desired], target = desired, first = current < 0;
      stopTimer();
      cancelImage();
      if (target === current && currentImage) {
        busyState();
        controlsState();
        schedule();
        return;
      }
      // The first title can be read immediately, even on a slow image connection.
      // It is initially paired only with the neutral fallback, never another title's image.
      if (first) renderSlide(item, target, null);
      const loading = prepareImage(item, first ? 'high' : 'auto');
      imageTask = loading;
      busyState();
      const image = loading ? await loading.promise : null;
      if (ticket !== generation || disposed) return;
      imageTask = null;
      renderSlide(item, target, image);
      busyState();
      schedule();
    }

    function setItems(nextItems) {
      if (disposed) return;
      remoteLoading = false;
      status.textContent = '';
      retry.hidden = true;
      const seen = new Set();
      const safe = (Array.isArray(nextItems) ? nextItems : []).filter(item => {
        if (!item || !validId(item.id) || typeof item.title !== 'string' || !item.title.trim() ||
            (!preview && (item.featured !== true || (item.status && item.status !== 'published'))) || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 12);
      const signature = JSON.stringify(safe);
      // Polls often return an identical selection: clear the loading status anyway,
      // without restarting the current slide, image request, keyboard focus or timer.
      if (signature === slideSignature) { busyState(); return; }
      const previousId = current >= 0 ? items[current]?.id : '';
      slideSignature = signature;
      items = safe;
      ++generation;
      stopTimer();
      cancelImage();
      indicators.replaceChildren();
      items.forEach((item, index) => {
        const indicator = make('button', 'hero-indicator');
        indicator.type = 'button';
        indicator.setAttribute('aria-label', 'Afficher ' + item.title);
        indicator.addEventListener('click', () => { autoplay = false; void select(index); });
        indicators.append(indicator);
      });
      if (!items.length) {
        current = -1;
        currentImage = null;
        photo.replaceChildren();
        root.classList.remove('has-artwork', 'hero-long-title');
        title.textContent = 'Votre prochaine histoire vous attend.';
        title.removeAttribute('title');
        description.textContent = 'La prochaine sélection de Hessflix sera bientôt à découvrir. Le catalogue reste accessible ci-dessous.';
        facts.replaceChildren();
        info.hidden = watch.hidden = true;
        info.removeAttribute('href');
        watch.removeAttribute('href');
        busyState();
        controlsState();
        return;
      }
      const retained = items.findIndex(item => item.id === previousId);
      current = -1;
      void select(Math.max(0, retained));
    }

    function move(direction) { autoplay = false; void select(desired + direction); }
    const onPrevious = () => move(-1);
    const onNext = () => move(1);
    const onPause = () => { autoplay = !autoplay; controlsState(); schedule(); };
    const onKey = event => {
      if (event.defaultPrevented || event.target instanceof HTMLAnchorElement || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowRight' ? 1 : -1);
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        autoplay = false;
        void select(event.key === 'Home' ? 0 : items.length - 1);
      }
    };
    const onEnter = () => { hovering = true; stopTimer(); };
    const onLeave = () => { hovering = false; schedule(); };
    const onFocus = () => { focusing = true; stopTimer(); };
    const onBlur = event => { if (!root.contains(event.relatedTarget)) { focusing = false; schedule(); } };
    const onVisibility = () => { if (document.hidden) stopTimer(); else schedule(); };
    const onMotion = () => { if (reduced.matches) autoplay = false; controlsState(); schedule(); };
    const onPreviewClick = event => { if (event.target.closest('a')) event.preventDefault(); };
    previous.addEventListener('click', onPrevious);
    next.addEventListener('click', onNext);
    pause.addEventListener('click', onPause);
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onMotion);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? false;
      schedule();
    }) : null;
    observer?.observe(root);
    if (preview) root.addEventListener('click', onPreviewClick);

    const api = {
      setItems, retry,
      loading() {
        if (disposed) return;
        remoteLoading = true;
        status.textContent = 'Chargement de la sélection…';
        retry.hidden = true;
        busyState();
      },
      error() {
        if (disposed) return;
        setItems([]);
        status.textContent = 'La sélection est temporairement indisponible.';
        retry.hidden = false;
      },
      destroy() {
        if (disposed) return;
        disposed = true;
        ++generation;
        stopTimer();
        cancelImage();
        observer?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        reduced.removeEventListener('change', onMotion);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('focusin', onFocus);
        root.removeEventListener('focusout', onBlur);
        root.removeEventListener('click', onPreviewClick);
        previous.removeEventListener('click', onPrevious);
        next.removeEventListener('click', onNext);
        pause.removeEventListener('click', onPause);
        root.setAttribute('aria-busy', 'false');
        if (mounted.get(root) === api) mounted.delete(root);
      }
    };
    mounted.set(root, api);
    setItems(initialItems);
    return api;
  }

  function start(root) {
    const view = mount(root);
    let request = null, refresh = 0, disposed = false;
    async function load() {
      if (disposed) return;
      request?.abort();
      request = new AbortController();
      const controller = request;
      const timeout = setTimeout(() => controller.abort(), 12000);
      view.loading();
      try {
        const response = await fetch('/api/catalogue/featured', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (controller !== request || disposed || !Array.isArray(data.items)) return;
        view.setItems(data.items);
      } catch {
        if (controller === request && !disposed && !(controller.signal.aborted && document.hidden)) view.error();
      } finally {
        clearTimeout(timeout);
        if (controller === request) {
          clearTimeout(refresh);
          if (!disposed && !document.hidden) refresh = setTimeout(() => { void load(); }, 60000);
        }
      }
    }
    const retry = () => { void load(); };
    const onVisibility = () => {
      clearTimeout(refresh);
      if (document.hidden) request?.abort();
      else if (!disposed) void load();
    };
    const originalDestroy = view.destroy;
    view.destroy = () => {
      if (disposed) return;
      disposed = true;
      request?.abort();
      clearTimeout(refresh);
      view.retry.removeEventListener('click', retry);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', view.destroy);
      originalDestroy();
    };
    view.retry.addEventListener('click', retry);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', view.destroy, { once: true });
    void load();
  }

  window.HessflixHero = { mount };
  const root = document.querySelector('[data-hero-banner]');
  if (root) start(root);
})();
