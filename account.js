// Présentation du compte et interface de connexion Firebase.
(() => {
  const allowedPages = ['index.html', 'netflix.html', 'prime-video.html', 'paramount.html', 'disney.html', 'marvel.html', 'compte.html', 'admin'];
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const requestedReturn = new URLSearchParams(location.search).get('retour');
  const validTitleReturn = value => typeof value === 'string' && /^titre\.html\?id=(?:movie-tt\d+|series-\d+|jw-(?:tm|ts)\d+)$/.test(value);
  const returnPage = allowedPages.includes(requestedReturn) || validTitleReturn(requestedReturn) ? requestedReturn : 'index.html';
  const candidateTitleReturn = 'titre.html?id=' + (new URLSearchParams(location.search).get('id') || '');
  const titleReturn = currentPage === 'titre.html' && validTitleReturn(candidateTitleReturn) ? candidateTitleReturn : 'index.html';
  const loginURL = () => `connexion.html?retour=${encodeURIComponent(allowedPages.includes(currentPage) ? currentPage : titleReturn)}`;
  const avatarFallback = 'assets/avatar-neutral.svg';
  /** @type {import('./types/contracts').AuthAdapter | null} */
  let adapter = null;
  let unsubscribe = null;
  /** @type {import('./types/contracts').Account | null} */
  let user = null;
  const listeners = new Set();
  const profileStore = window.MovixProfiles?.createStore({ getToken: () => adapter.getIdToken(), onChange: notify });
  const activeUser = () => {
    if (!user) return null;
    const profile = profileStore?.selected();
    return profile ? { ...user, displayName: profile.displayName, photoURL: profile.photoURL, profileId: profile.id,profileReady:profileStore.state().ready } : {...user,profileReady:false};
  };
  const iconPaths = {
    user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
    circle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8.5" r="3"/><path d="M5 18a7.5 7.5 0 0 1 14 0"/>',
    swap: '<path d="M5 7h14m-4-4 4 4-4 4M19 17H5m4-4-4 4 4 4"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1"/>',
    star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L3 9.6l6.2-.9Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    settings: '<path d="m9 3-.6 2.1-2 .9-2-.5-2 3.5 1.5 1.7v2.6L2.4 15l2 3.5 2-.5 2 .9.6 2.1h4l.6-2.1 2-.9 2 .5 2-3.5-1.5-1.7v-2.6l1.5-1.7-2-3.5-2 .5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    crown: '<path d="m3 5 4 4 5-6 5 6 4-4-2 12H5ZM5 21h14"/>',
    logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.user}</svg>`;
  const menuItems = [['profils', 'swap', 'Changer de profil'], ['profil', 'user', 'Profil'], ['a-voir', 'list', 'À voir'], ['en-cours', 'list', 'En cours'], ['favoris', 'star', 'Favoris'], ['visionnes', 'check', 'Déjà vu'], ['temps', 'settings', 'Temps sur le site'], ['parametres', 'settings', 'Réglages']];

  function setAvatar(image, account) {
    const source = account?.photoURL;
    image.src = window.MovixModel.avatarSource(source);
    image.addEventListener('error', () => { image.src = avatarFallback; }, { once: true });
  }
  function providerLabel(account) {
    return account.provider === 'google.com' ? 'Connecté avec Google' : 'Connecté avec votre compte';
  }
  function notify() {
    document.querySelectorAll('[data-account-slot]').forEach(renderAccount);
    listeners.forEach(listener => listener(activeUser()));
    renderSessionWarning();
  }
  function renderSessionWarning() {
    let banner = document.querySelector('#server-session-warning');
    if (!window.MovixSession?.pending()) { banner?.remove(); return; }
    if (banner) return;
    banner = document.createElement('aside'); banner.id = 'server-session-warning'; banner.className = 'session-warning'; banner.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.textContent = 'La fermeture de la session serveur reste à confirmer. Réessayez avant de quitter un appareil partagé.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Réessayer de fermer la session serveur';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try {
        await window.MovixSession.clearServerSession(); renderSessionWarning();
        if (location.pathname === '/admin') location.reload();
      } catch { message.textContent = 'Serveur toujours indisponible : la fermeture de la session serveur reste à confirmer. Réessayez avant de laisser un tiers utiliser cet appareil partagé.'; retry.disabled = false; }
    });
    banner.append(message, retry); document.body.append(banner);
  }
  function closeMenus(restoreFocus = false) {
    document.querySelectorAll('.account-dropdown').forEach(panel => {
      if (panel.hidden) return;
      panel.hidden = true;
      const trigger = panel.parentElement.querySelector('.account-trigger');
      trigger?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger?.focus();
    });
  }
  function renderAccount(slot) {
    slot.classList.add('account-slot');
    const account = activeUser();
    if (!account) {
      slot.innerHTML = `<a class="account-disconnected" href="${loginURL()}">${icon('circle')}<span>Profil <span class="account-status">(Déconnecté)</span></span></a>`;
      return;
    }
    slot.innerHTML = `
      <button type="button" class="account-trigger" aria-expanded="false" aria-controls="account-dropdown" aria-label="Ouvrir le menu du profil"><img class="account-avatar" alt=""><span>Profil</span>${icon('chevron')}</button>
      <div class="account-dropdown" id="account-dropdown" hidden>
        <div class="account-summary"><img class="account-avatar" alt=""><div><strong class="account-name"></strong><p class="account-provider"></p></div></div>
        <div class="account-links">${menuItems.map(([id, symbol, label]) => `<a href="compte.html#${id}" ${id === 'profils' ? 'data-switch-profile' : ''} class="account-menu-link ${id === 'profil' || id === 'parametres' ? 'account-menu-separated' : ''}">${icon(symbol)}<span>${label}</span></a>`).join('')}</div>
        ${account.admin === true ? `<a href="/admin" class="account-menu-link account-menu-separated">${icon('settings')}<span>Administration</span></a>` : ''}
        <a href="compte.html#vip" class="account-vip">${icon('crown')}<span>Devenir VIP</span></a>
        <button type="button" class="account-logout">${icon('logout')}<span>Se déconnecter</span></button>
        <p class="account-error" role="status" hidden></p>
      </div>`;
    slot.querySelector('.account-name').textContent = account.displayName || 'Profil';
    slot.querySelector('.account-provider').textContent = providerLabel(account);
    slot.querySelectorAll('img').forEach(image => setAvatar(image, account));
    const trigger = slot.querySelector('.account-trigger');
    const panel = slot.querySelector('.account-dropdown');
    const toggle = () => {
      const opening = panel.hidden;
      closeMenus();
      panel.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
    };
    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); if (panel.hidden) toggle(); panel.querySelector('a').focus(); }
    });
    slot.querySelector('.account-logout').addEventListener('click', async event => {
      const logoutButton = event.currentTarget;
      logoutButton.disabled = true;
      try {
        if (user) await adapter.signOut();
        user = null;
        profileStore?.setAccount(null);
        notify();
        slot.querySelector('a')?.focus();
      } catch {
        renderSessionWarning();
        logoutButton.disabled = false;
        const message = slot.querySelector('.account-error');
        message.textContent = 'Déconnexion impossible pour le moment. Réessayez.';
        message.hidden = false;
      }
    });
  }

  // Contrat de connexion : subscribe(callback), signInWithGoogle(), signInWithEmail(email, password), signOut().
  // Le formulaire utilise aussi createAccount(email, password, name) et sendPasswordReset(email).
  // L'utilisateur normalisé contient displayName, photoURL et provider ('google.com', 'password', ...).
  window.MovixAccount = {
    async signOut() { if (user) await adapter.signOut(); user=null; profileStore?.setAccount(null); notify(); },
    getUser: activeUser,
    getIdToken(forceRefresh = false) { return adapter ? adapter.getIdToken(forceRefresh) : Promise.reject(new Error('Connexion requise')); },
    refreshPermissions() { return adapter ? adapter.refreshPermissions() : Promise.reject(new Error('Connexion requise')); },
    updateAvatar(photoURL) {
      const profile = profileStore?.selected();
      if (profile && !profile.primary) return profileStore.update(profile.id, { photoURL: photoURL || '' }).then(() => {});
      return adapter ? adapter.updateAvatar(photoURL) : Promise.reject(new Error('Connexion requise'));
    },
    updateDisplayName(displayName) {
      const profile = profileStore?.selected();
      if (profile && !profile.primary) return profileStore.update(profile.id, { displayName }).then(() => {});
      return adapter ? adapter.updateDisplayName(displayName) : Promise.reject(new Error('Connexion requise'));
    },
    subscribe(listener) { listeners.add(listener); listener(activeUser()); return () => listeners.delete(listener); },
    connectAuth(authAdapter) {
      if (!authAdapter || ['subscribe', 'signInWithGoogle', 'signInWithEmail', 'signOut'].some(method => typeof authAdapter[method] !== 'function')) throw new TypeError('Adaptateur de connexion incomplet');
      unsubscribe?.();
      adapter = authAdapter;
      user = null;
      notify();
      unsubscribe = adapter.subscribe(account => { user = account; profileStore?.setAccount(account); notify(); });
    }
  };
  document.addEventListener('click', event => { if (!event.target.closest('.account-slot')) closeMenus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(true); });
  window.addEventListener('pagehide', () => closeMenus());
  window.HessflixActivity?.connect();
  notify();
  if (window.MovixAuthAdapter) window.MovixAccount.connectAuth(window.MovixAuthAdapter);

  window.MovixLogin?.({ getAdapter: () => adapter, returnPage });
  window.MovixProfilePage?.({ activeUser, setAvatar, providerLabel });
  if (profileStore) window.MovixProfiles.mount({ store: profileStore, account: activeUser });
})();
