// Private editorial workspace. It shares the existing authenticated/CSRF client.
(() => {
  const panel = document.getElementById('admin-hero-panel');
  const client = window.HessflixAdminCatalogue;
  if (!panel || !client) return;

  const MAX = 12;
  const node = id => document.getElementById(id);
  const controls = ['save', 'preview', 'publish', 'reload', 'more', 'gallery-close', 'gallery-auto'];
  const feedback = node('admin-hero-feedback');
  const selection = node('admin-hero-selection');
  const candidatesRoot = node('admin-hero-candidates');
  const gallery = node('admin-hero-gallery');
  const previewSection = node('admin-hero-preview-section');
  const candidates = new Map();
  let slots = [], version = 0, published = [], cursor = '';
  let loaded = false, loading = false, dirty = false, serverPending = false;
  let overwriteConfirmation = false, galleryId = '', preview = null;

  function make(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function button(label, action, className = '') {
    const control = make('button', className, label);
    control.classList.add('catalogue-secondary');
    control.type = 'button';
    control.dataset.adminHeroControl = 'true';
    control.addEventListener('click', action);
    return control;
  }

  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle('is-error', error);
  }

  function failure(error) {
    const text = error instanceof TypeError || error?.name === 'TimeoutError' || error?.name === 'AbortError' ?
      'Connexion interrompue : aucun succès n’a été confirmé. Vos choix locaux sont conservés ; réessayez ou rechargez la version du serveur.' :
      error instanceof Error ? error.message : 'Opération impossible. Vos choix locaux sont conservés.';
    message(text, true);
  }

  function validImage(value) {
    return typeof value === 'string' && (/^https:\/\/image\.tmdb\.org\/t\/p\/(?:w342|w500|w780|w1280)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value) || /^assets\/discovery\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(value));
  }

  function thumbnail(source, alt = '') {
    const image = document.createElement('img');
    image.alt = alt;
    image.width = 320;
    image.height = 180;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = source.startsWith('assets/') ? '/' + source : source.replace('/w1280/', '/w500/').replace('/w780/', '/w500/');
    image.addEventListener('error', () => { image.hidden = true; });
    return image;
  }

  function entryItem(entry, image = '') {
    return {
      ...entry.meta,
      id: entry.aliases?.[0] || entry.id,
      catalogueId: entry.id,
      title: entry.editor.title || entry.meta.title,
      overview: entry.editor.overview || entry.meta.overview || '',
      kind: entry.mediaType === 'movie' ? 'Film' : 'Série',
      category: entry.editor.category,
      isAnime: entry.editor.category === 'Anime',
      heroBackdrop: image || entry.meta.backdrop || ''
    };
  }

  function titleOf(slot) { return slot.item?.title || 'Contenu indisponible'; }

  function updateControls() {
    panel.setAttribute('aria-busy', String(loading));
    panel.querySelectorAll('[data-admin-hero-control], #admin-hero-search input, #admin-hero-search button').forEach(control => {
      control.disabled = loading;
    });
    node('admin-hero-save').disabled = loading || !loaded || !dirty;
    node('admin-hero-preview').disabled = loading || !loaded;
    node('admin-hero-publish').disabled = loading || !loaded || dirty || !serverPending || slots.some(slot => slot.available === false);
    panel.querySelectorAll('[data-boundary="true"]').forEach(control => { control.disabled = true; });
    panel.querySelectorAll('[data-add-hero]').forEach(control => {
      const selected = slots.some(slot => slot.id === control.dataset.addHero);
      control.disabled = loading || selected || slots.length >= MAX;
      control.textContent = selected ? 'Déjà sélectionné' : 'Ajouter à la bannière';
    });
  }

  async function work(action) {
    if (loading) return;
    loading = true;
    updateControls();
    try { await action(); }
    catch (error) { failure(error); }
    finally { loading = false; updateControls(); }
  }

  function previewItems() {
    return slots.filter(slot => slot.available !== false && slot.item).map(slot => ({
      ...slot.item,
      heroBackdrop: slot.image || slot.item.backdrop || ''
    }));
  }

  function updatePreview() {
    if (previewSection.hidden) return;
    if (!preview && window.HessflixHero) preview = window.HessflixHero.mount(node('admin-hero-preview-view'), { preview: true, items: previewItems() });
    else preview?.setItems(previewItems());
  }

  function changed() {
    dirty = true;
    message('Choix modifiés uniquement dans cet onglet. Enregistrez le brouillon avant de publier.');
    render();
  }

  function move(id, direction) {
    const index = slots.findIndex(slot => slot.id === id);
    const target = index + direction;
    if (loading || target < 0 || target >= slots.length) return;
    [slots[index], slots[target]] = [slots[target], slots[index]];
    changed();
    const row = selection.querySelector('[data-slot-id="' + id + '"]');
    const same = row?.querySelector('[data-move="' + direction + '"]');
    (same && !same.disabled ? same : row?.querySelector('[data-move="' + -direction + '"]'))?.focus();
  }

  function render() {
    selection.replaceChildren();
    slots.forEach((slot, index) => {
      const row = make('li', 'admin-hero-slot');
      row.dataset.slotId = slot.id;
      const art = make('div', 'admin-hero-slot-art');
      const source = slot.image || slot.item?.backdrop || slot.item?.image;
      if (validImage(source)) art.append(thumbnail(source));
      else art.append(make('span', '', 'H'));
      const copy = make('div', 'admin-hero-slot-copy');
      copy.append(make('small', 'admin-hero-order', String(index + 1).padStart(2, '0') + ' · ORDRE DE PRÉSENTATION'), make('h4', '', titleOf(slot)));
      copy.append(make('p', 'catalogue-hint', slot.available === false ? 'Ce titre n’est plus publié. Retirez-le pour poursuivre.' : [slot.item?.category || slot.item?.kind, slot.item?.year].filter(Boolean).join(' · ')));
      const actions = make('div', 'admin-hero-slot-actions');
      const up = button('↑ Monter', () => move(slot.id, -1), 'catalogue-secondary');
      const down = button('↓ Descendre', () => move(slot.id, 1), 'catalogue-secondary');
      up.dataset.move = '-1'; down.dataset.move = '1';
      up.dataset.boundary = String(index === 0); down.dataset.boundary = String(index === slots.length - 1);
      up.setAttribute('aria-label', 'Monter ' + titleOf(slot)); down.setAttribute('aria-label', 'Descendre ' + titleOf(slot));
      const choose = button('Image de fond', () => { void work(() => showGallery(slot.id)); }, 'catalogue-secondary');
      choose.dataset.chooseHeroImage = 'true';
      choose.setAttribute('aria-label', 'Image de fond pour ' + titleOf(slot));
      const remove = button('Retirer', () => { slots = slots.filter(item => item.id !== slot.id); changed(); }, 'admin-hero-remove');
      remove.setAttribute('aria-label', 'Retirer ' + titleOf(slot) + ' de la bannière');
      actions.append(up, down, choose, remove);
      copy.append(actions); row.append(art, copy); selection.append(row);
    });
    node('admin-hero-empty').hidden = slots.length > 0;
    node('admin-hero-count').textContent = slots.length + ' / ' + MAX;
    node('admin-hero-public-state').textContent = !loaded ? 'Chargement…' : published.length + ' titre' + (published.length > 1 ? 's' : '') + ' actuellement publié' + (published.length > 1 ? 's' : '');
    node('admin-hero-draft-state').textContent = !loaded ? 'La sélection sera chargée à l’ouverture de cet onglet.' :
      'Version serveur ' + version + ' · ' + (dirty ? 'Modifications locales non enregistrées' : serverPending ? 'Brouillon enregistré, non publié' : 'Aucun changement en attente de publication');
    updateControls();
    updatePreview();
  }

  function renderCandidates() {
    candidatesRoot.replaceChildren();
    for (const entry of candidates.values()) {
      const card = make('article', 'admin-hero-candidate');
      const item = entryItem(entry);
      const copy = make('div', 'admin-hero-candidate-copy');
      copy.append(make('h4', '', item.title), make('p', 'catalogue-hint', [entry.editor.category, item.year].filter(Boolean).join(' · ')));
      const add = button('Ajouter à la bannière', () => {
        if (slots.length >= MAX || slots.some(slot => slot.id === entry.id)) return;
        slots.push({ id: entry.id, image: '', item, available: true });
        changed();
      });
      add.dataset.addHero = entry.id;
      copy.append(add);
      if (validImage(item.image)) card.append(thumbnail(item.image));
      card.append(copy); candidatesRoot.append(card);
    }
    if (!candidates.size) candidatesRoot.append(make('p', 'catalogue-hint', 'Aucun titre publié sur cette page. Essayez la page suivante ou publiez d’abord une fiche du catalogue.'));
    node('admin-hero-more').hidden = !cursor;
    updateControls();
  }

  async function loadCandidates(append = false) {
    const params = new URLSearchParams({ status: 'published', query: node('admin-hero-query').value.trim() });
    if (append && cursor) params.set('cursor', cursor);
    const result = await client.request('/api/admin/catalogue?' + params);
    if (!Array.isArray(result.entries)) throw new Error('La liste des titres publiés est indisponible. Réessayez.');
    if (!append) candidates.clear();
    for (const entry of result.entries) if (entry.status === 'published') candidates.set(entry.id, entry);
    cursor = result.nextCursor || '';
    renderCandidates();
  }

  async function load(preserve = false) {
    message('Chargement de la bannière et de son brouillon…');
    const result = await client.request('/api/admin/catalogue/hero');
    if (!Number.isSafeInteger(result.version) || !Array.isArray(result.entries) || !Array.isArray(result.published)) throw new Error('La réponse du serveur est invalide. Vos choix locaux sont conservés.');
    const keep = preserve && dirty;
    if (keep) {
      const refreshed = await Promise.all(slots.map(async slot => {
        try {
          const data = await client.request('/api/admin/catalogue/' + slot.id);
          return { ...slot, item: entryItem(data.entry, slot.image), available: data.entry.status === 'published' };
        } catch (error) {
          if (error?.code === 'CATALOGUE_NOT_FOUND') return { ...slot, available: false };
          throw error;
        }
      }));
      slots = refreshed;
      overwriteConfirmation = true;
    } else {
      slots = result.entries;
      dirty = false;
      overwriteConfirmation = false;
    }
    version = result.version;
    published = result.published;
    serverPending = result.pending;
    loaded = true;
    render();
    message(keep ? 'Version du serveur rechargée. Vos choix locaux sont conservés. Une confirmation sera demandée avant de remplacer le brouillon serveur.' : serverPending ? 'Votre brouillon privé est chargé. Prévisualisez-le avant de le publier.' : 'La sélection publiée est chargée. Vos prochains changements resteront privés jusqu’à publication.');
  }

  function applySaved(result) {
    slots = result.entries;
    version = result.version;
    published = result.published;
    serverPending = result.pending;
    dirty = false;
    overwriteConfirmation = false;
    render();
  }

  async function save() {
    if (overwriteConfirmation && !window.confirm('Remplacer le brouillon actuellement enregistré sur le serveur par vos choix locaux ? Les visiteurs ne verront aucun changement à cette étape.')) return;
    const result = await client.request('/api/admin/catalogue/hero', 'PUT', { version, slots: slots.map(({ id, image }) => ({ id, image })) });
    applySaved(result);
    message('Brouillon enregistré. Les visiteurs voient toujours la sélection précédemment publiée.');
  }

  async function publish() {
    if (dirty) { message('Enregistrez d’abord votre brouillon avant de le publier.', true); return; }
    if (!window.confirm(slots.length ? 'Publier ces ' + slots.length + ' titres dans cet ordre sur la bannière d’accueil ? Les options « Mettre en avant » et « Ordre de présentation » seront mises à jour.' : 'Publier une sélection vide et retirer tous les titres de la bannière d’accueil ?')) return;
    const result = await client.request('/api/admin/catalogue/hero/publish', 'POST', { version });
    applySaved(result);
    message('Bannière publiée. Tous les visiteurs verront cette sélection ; aucun contenu du catalogue n’a été supprimé.');
    window.dispatchEvent(new Event('hessflix-admin-hero-published'));
  }

  async function showGallery(id) {
    const slot = slots.find(item => item.id === id);
    if (!slot) return;
    const result = await client.request('/api/admin/catalogue/' + id + '/hero-images');
    galleryId = id;
    node('admin-hero-gallery-auto').setAttribute('aria-pressed', String(!slot.image));
    node('admin-hero-gallery-heading').textContent = 'Image de fond · ' + titleOf(slot);
    node('admin-hero-gallery-status').textContent = result.warning || 'Choisissez un fond proposé pour ce titre. Les miniatures sont allégées ; le fond est enregistré en haute définition.';
    const options = node('admin-hero-gallery-options');
    options.replaceChildren();
    for (const [index, image] of (result.images || []).filter(validImage).entries()) {
      const choice = button('Choisir le fond ' + (index + 1), () => chooseImage(image), 'admin-hero-image-choice');
      choice.prepend(thumbnail(image));
      choice.setAttribute('aria-pressed', String(slot.image === image));
      choice.dataset.image = image;
      options.append(choice);
    }
    if (!options.childElementCount) options.append(make('p', 'catalogue-hint', 'Aucun fond supplémentaire disponible. Le fond automatique utilisera une image connue ou une composition neutre.'));
    gallery.showModal();
  }

  function chooseImage(image) {
    const slot = slots.find(item => item.id === galleryId);
    if (!slot) return;
    slot.image = image;
    gallery.close();
    changed();
    selection.querySelector('[data-slot-id="' + galleryId + '"] [data-choose-hero-image]')?.focus();
  }

  for (const id of controls) node('admin-hero-' + id).dataset.adminHeroControl = 'true';
  node('admin-hero-save').addEventListener('click', () => { void work(save); });
  node('admin-hero-publish').addEventListener('click', () => { void work(publish); });
  node('admin-hero-reload').addEventListener('click', () => { void work(() => load(true)); });
  node('admin-hero-preview').addEventListener('click', () => {
    previewSection.hidden = false;
    updatePreview();
    previewSection.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  node('admin-hero-search').addEventListener('submit', event => { event.preventDefault(); void work(() => loadCandidates()); });
  node('admin-hero-more').addEventListener('click', () => { void work(() => loadCandidates(true)); });
  node('admin-hero-gallery-close').addEventListener('click', () => gallery.close());
  node('admin-hero-gallery-auto').addEventListener('click', () => chooseImage(''));
  window.addEventListener('hessflix-admin-tab', event => {
    if (event.detail === 'hero' && !loaded) void work(async () => { await load(); await loadCandidates(); });
  });
  window.addEventListener('hessflix-admin-catalogue-changed', event => {
    const { id, entry } = event.detail;
    if (entry?.status === 'published') candidates.set(id, entry);
    else candidates.delete(id);
    if (!dirty) {
      loaded = false;
      preview?.destroy();
      preview = null;
      previewSection.hidden = true;
    } else {
      const slot = slots.find(item => item.id === id);
      if (slot) {
        if (entry) slot.item = entryItem(entry, slot.image);
        slot.available = entry?.status === 'published';
      }
      message('Une fiche du catalogue a été modifiée. Vos choix locaux sont conservés ; rechargez le serveur pour vérifier la sélection avant publication.');
    }
    render();
    renderCandidates();
  });
  window.addEventListener('pagehide', () => preview?.destroy(), { once: true });
  render();
})();
