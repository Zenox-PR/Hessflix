// Sélection d’avatars : la modification du compte passe exclusivement par Firebase Auth.
(() => {
  const trigger = document.querySelector('#profile-avatar-trigger');
  const dialog = document.querySelector('#avatar-dialog');
  const catalogue = window.MovixAvatars;
  if (!trigger || !dialog || !catalogue?.categories?.length) return;
  const editor = document.querySelector('#profile-avatar-editor');
  const menu = document.querySelector('#profile-avatar-menu');
  const change = document.querySelector('#change-avatar');
  const remove = document.querySelector('#remove-avatar');
  const close = document.querySelector('#close-avatar-dialog');
  const tabs = document.querySelector('#avatar-category-tabs');
  const gallery = document.querySelector('#avatar-gallery');
  const message = document.querySelector('#avatar-save-status');
  const profileMessage = document.querySelector('#avatar-profile-status');
  const count = document.querySelector('#avatar-category-count');
  const allowed = new Set(catalogue.categories.flatMap(category => category.groups.flatMap(group => group.avatars.map(avatar => avatar.photoURL))));
  let categoryId = catalogue.categories[0].id;
  let busy = false;
  let accountUID = null;
  // Le lazy-loading natif précharge largement hors écran dans une fenêtre défilante.
  // Un seul observateur réutilisé borne ici les téléchargements à la zone bientôt visible.
  const imageObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      image.src = image.dataset.avatarSrc;
      delete image.dataset.avatarSrc;
      imageObserver.unobserve(image);
    }
  }, { root: gallery, rootMargin: '200px 0px' }) : null;
  const account = () => window.MovixAccount?.getUser();
  const identity = () => account() ? `${account().uid}/${account().profileId || 'primary'}` : null;

  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  function controls() {
    const user = account();
    trigger.disabled = busy || !user;
    remove.disabled = busy || !user?.photoURL;
    change.disabled = busy || !user;
    close.disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
    gallery.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    tabs.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  function markSelected() {
    const selected = account()?.photoURL;
    gallery.querySelectorAll('.avatar-option').forEach(button => {
      const chosen = button.dataset.photoUrl === selected;
      button.setAttribute('aria-pressed', String(chosen));
      button.classList.toggle('is-selected', chosen);
    });
  }
  async function save(photoURL) {
    if (busy || !account()) return;
    if (photoURL !== null && !allowed.has(photoURL)) return;
    const uid = identity();
    busy = true;
    closeMenu();
    controls();
    profileMessage.hidden = true;
    message.dataset.state = 'saving';
    message.textContent = photoURL === null ? 'Suppression de l’avatar…' : 'Enregistrement de votre avatar…';
    try {
      await window.MovixAccount.updateAvatar(photoURL);
      if (identity() !== uid) return;
      if (dialog.open) dialog.close();
      profileMessage.textContent = photoURL === null ? 'Avatar supprimé. Votre profil utilise maintenant un avatar neutre.' : 'Votre nouvel avatar est enregistré.';
      profileMessage.dataset.state = 'success';
      profileMessage.hidden = false;
      markSelected();
    } catch {
      if (identity() !== uid) return;
      const text = 'L’avatar n’a pas pu être enregistré. Vérifiez votre connexion et réessayez.';
      message.textContent = text;
      message.dataset.state = 'error';
      profileMessage.textContent = text;
      profileMessage.dataset.state = 'error';
      profileMessage.hidden = false;
    } finally {
      busy = false;
      controls();
      if (!dialog.open && identity() === uid) trigger.focus();
    }
  }
  function renderGallery() {
    const category = catalogue.categories.find(item => item.id === categoryId);
    if (!category) return;
    tabs.querySelectorAll('[role="tab"]').forEach(tab => {
      const active = tab.dataset.category === categoryId;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    gallery.setAttribute('aria-labelledby', `avatar-tab-${categoryId}`);
    imageObserver?.disconnect();
    gallery.replaceChildren();
    const fragment = document.createDocumentFragment();
    let total = 0;
    let imageIndex = 0;
    for (const group of category.groups) {
      const section = document.createElement('section');
      section.className = 'avatar-group';
      const heading = document.createElement('h3');
      heading.textContent = group.name;
      const grid = document.createElement('div');
      grid.className = 'avatar-options';
      for (const avatar of group.avatars) {
        const button = document.createElement('button');
        button.className = 'avatar-option';
        button.type = 'button';
        button.dataset.photoUrl = avatar.photoURL;
        button.setAttribute('aria-label', `Choisir ${avatar.name} — ${group.name}`);
        button.title = avatar.name;
        const image = document.createElement('img');
        if (imageObserver && imageIndex++ >= 8) image.dataset.avatarSrc = avatar.src;
        else image.src = avatar.src;
        image.alt = '';
        image.width = image.height = 96;
        image.loading = imageObserver ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => { image.src = 'assets/avatar-neutral.svg'; }, { once: true });
        if (imageObserver && image.dataset.avatarSrc) imageObserver.observe(image);
        button.append(image);
        button.addEventListener('click', () => save(avatar.photoURL));
        grid.append(button);
      }
      total += group.avatars.length;
      section.append(heading, grid);
      fragment.append(section);
    }
    gallery.append(fragment);
    gallery.scrollTop = 0;
    count.textContent = `${total} avatars · ${category.name}`;
    markSelected();
    controls();
  }
  for (const category of catalogue.categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `avatar-tab-${category.id}`;
    button.dataset.category = category.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'avatar-gallery');
    button.textContent = category.name;
    button.addEventListener('click', () => { categoryId = category.id; renderGallery(); });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = catalogue.categories.findIndex(item => item.id === categoryId);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? catalogue.categories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + catalogue.categories.length) % catalogue.categories.length;
      categoryId = catalogue.categories[next].id;
      renderGallery();
      tabs.querySelector('[aria-selected="true"]').focus();
    });
    tabs.append(button);
  }
  trigger.addEventListener('click', () => {
    if (busy || !account()) return;
    const opening = menu.hidden;
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) change.focus();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (menu.hidden) trigger.click(); else change.focus(); }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const choices = [change, remove].filter(button => !button.disabled);
      const index = choices.indexOf(document.activeElement);
      choices[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus();
    }
  });
  document.addEventListener('click', event => { if (!editor.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) closeMenu(true); });
  editor.addEventListener('focusout', event => { if (!editor.contains(event.relatedTarget)) closeMenu(); });
  change.addEventListener('click', () => {
    if (busy || !account()) return;
    closeMenu();
    const selected = account().photoURL;
    const current = catalogue.categories.find(category => category.groups.some(group => group.avatars.some(avatar => avatar.photoURL === selected)));
    if (current) categoryId = current.id;
    message.textContent = 'Cliquez sur un avatar pour le choisir.';
    message.dataset.state = '';
    renderGallery();
    dialog.showModal();
    document.body.classList.add('avatar-dialog-open');
    tabs.querySelector('[aria-selected="true"]').focus();
  });
  remove.addEventListener('click', () => save(null));
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { imageObserver?.disconnect(); document.body.classList.remove('avatar-dialog-open'); if (account()) trigger.focus(); });
  dialog.addEventListener('click', event => {
    if (busy || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  window.MovixAccount?.subscribe(user => {
    if (accountUID !== identity()) {
      closeMenu();
      if (dialog.open) dialog.close();
      profileMessage.hidden = true;
    }
    accountUID = identity();
    controls();
    markSelected();
  });
})();
