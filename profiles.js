// Profils de spectateurs : une seule identité Firebase, des préférences distinctes.
(() => {
  function createStore({ getToken, onChange }) {
    let owner = null, extra = [], activeId = 'primary', ready = false, loading = false, error = '', generation = 0;
    let chain = Promise.resolve(), loadingTask = null;
    const key = uid => `movix-active-profile:${uid}`;
    function remember() { try { localStorage.setItem(key(owner.uid), activeId); } catch { /* Stockage navigateur facultatif. */ } }
    function all() {
      return owner ? [{ id: 'primary', displayName: owner.displayName || 'Profil', photoURL: owner.photoURL || '', primary: true }, ...extra.map(profile => ({ ...profile, primary: false }))] : [];
    }
    function selected() { const profiles = all(); return profiles.find(profile => profile.id === activeId) || profiles[0] || null; }
    function enqueue(action) {
      const epoch = generation;
      const run = () => { if (epoch !== generation) throw new Error('Le compte a changé.'); return action(); };
      const task = chain.then(run, run); chain = task.catch(() => {}); return task;
    }
    async function request(method, id, payload) {
      const epoch = generation;
      const uid = owner?.uid;
      if (!uid) throw new Error('Connexion requise');
      const token = await getToken();
      if (epoch !== generation) throw new Error('Le compte a changé.');
      const response = await fetch('/api/profiles' + (id ? '/' + encodeURIComponent(id) : ''), {
        method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      });
      const result = await response.json();
      if (epoch !== generation || owner?.uid !== uid) throw new Error('Le compte a changé.');
      if (!response.ok) throw Object.assign(new Error('Profils indisponibles'), { code: result.error });
      if (!Array.isArray(result.profiles) || result.profiles.length > 4 || !result.profiles.every(profile => /^[a-f0-9-]{36}$/.test(profile.id) && window.MovixModel.validProfile({ displayName: profile.displayName, photoURL: profile.photoURL }))) throw new Error('Réponse de profils invalide');
      extra = result.profiles.map(({ id, displayName, photoURL }) => ({ id, displayName, photoURL }));
      try{localStorage.setItem('movix-profiles-cache:'+uid,JSON.stringify(extra));}catch{}
      ready = true; error = '';
      if (!all().some(profile => profile.id === activeId)) { activeId = 'primary'; remember(); }
      onChange();
      return all();
    }
    function load() {
      if (!owner) return Promise.resolve([]);
      if (loadingTask) return loadingTask;
      const epoch = generation;
      loading = true; onChange();
      loadingTask = enqueue(() => request('GET')).catch(cause => {
        if (epoch === generation) { error = 'Impossible de charger les profils. Vérifiez votre connexion puis réessayez.'; onChange(); }
        throw cause;
      }).finally(() => {
        if (epoch === generation) { loading = false; loadingTask = null; onChange(); }
      });
      return loadingTask;
    }
    return {
      all, selected, load,
      state: () => ({ ready, loading, error, maximum: 5 }),
      setAccount(account) {
        if (owner?.uid === account?.uid) { owner = account; return; }
        generation++; owner = account; extra = []; ready = false; loading = false; error = ''; loadingTask = null; activeId = 'primary';
        if (owner) {
          try { activeId = localStorage.getItem(key(owner.uid)) || 'primary'; } catch { /* Choix par défaut. */ }
          try{const cached=JSON.parse(localStorage.getItem('movix-profiles-cache:'+owner.uid)||'null');if(Array.isArray(cached)&&cached.length<=4&&cached.every(profile=>/^[a-f0-9-]{36}$/.test(profile.id)&&window.MovixModel.validProfile({displayName:profile.displayName,photoURL:profile.photoURL}))){extra=cached;if(activeId==='primary'||extra.some(profile=>profile.id===activeId))ready=true;}}catch{}
          load().catch(() => {});
        }
      },
      select(id) {
        if (!all().some(profile => profile.id === id)) throw new Error('Profil introuvable');
        activeId = id; remember(); onChange();
      },
      create(displayName) {
        const known = new Set(all().map(profile => profile.id));
        return enqueue(async () => { await request('POST', null, { displayName, photoURL: '' }); return all().find(profile => !known.has(profile.id)); });
      },
      update(id, changes) { return enqueue(() => request('PATCH', id, changes)); },
      remove(id) { return enqueue(() => request('DELETE', id)); }
    };
  }
  function mount({ store, account }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'viewer-dialog'; dialog.id = 'viewer-dialog';
    dialog.setAttribute('aria-labelledby', 'viewer-title');
    dialog.innerHTML = `
      <button type="button" class="viewer-close" id="viewer-close" aria-label="Fermer les profils">×</button>
      <p class="viewer-eyebrow">VOTRE ESPACE HESSFLIX</p><h2 id="viewer-title">Qui regarde ?</h2>
      <p class="viewer-intro" id="viewer-intro">À chacun son univers.</p>
      <div class="viewer-cards" id="viewer-cards"></div>
      <form class="viewer-form" id="viewer-add-form" hidden>
        <div class="viewer-new-avatar"><img src="/assets/avatar-neutral.svg" alt="Avatar neutre"></div>
        <div class="viewer-new-fields"><label for="viewer-name">Nom du profil</label><input id="viewer-name" type="text" maxlength="60" autocomplete="nickname" required aria-describedby="viewer-add-help viewer-message"><p id="viewer-add-help">Vous pourrez choisir un avatar dans votre profil après la création.</p><div class="viewer-form-actions"><button class="viewer-primary" type="submit">Créer le profil</button><button type="button" id="viewer-cancel-add">Annuler</button></div></div>
      </form>
      <section class="viewer-delete" id="viewer-delete" hidden><p id="viewer-delete-description"></p><div class="viewer-form-actions"><button type="button" class="viewer-danger" id="viewer-confirm-delete">Supprimer le profil</button><button type="button" id="viewer-cancel-delete">Annuler</button></div></section>
      <p id="viewer-message" class="viewer-message" role="status" hidden></p>
      <footer class="viewer-footer"><button type="button" id="viewer-manage"><span aria-hidden="true">⚙</span> Gérer les profils</button><button type="button" id="viewer-done" hidden>Terminer</button><button type="button" id="viewer-retry" hidden>Réessayer</button></footer>`;
    document.body.append(dialog);
    const cards = dialog.querySelector('#viewer-cards'), title = dialog.querySelector('#viewer-title');
    const intro = dialog.querySelector('#viewer-intro'), form = dialog.querySelector('#viewer-add-form');
    const input = dialog.querySelector('#viewer-name'), message = dialog.querySelector('#viewer-message');
    const deletion = dialog.querySelector('#viewer-delete'), manage = dialog.querySelector('#viewer-manage');
    const done = dialog.querySelector('#viewer-done'), retry = dialog.querySelector('#viewer-retry');
    let managing = false, view = 'list', busy = false, deleting = null, lastFocus = null, currentIdentity = null, hashOpened = false;
    function announce(text) { message.textContent = text; message.hidden = !text; }
    function lock() {
      dialog.setAttribute('aria-busy', String(busy));
      dialog.querySelectorAll('button, input').forEach(control => { control.disabled = busy || control.dataset.unavailable === 'true'; });
    }
    function edit(profile) {
      store.select(profile.id); dialog.close();
      location.assign('/compte.html#profil');
    }
    function draw() {
      if (!dialog.open) return;
      const state = store.state();
      title.textContent = view === 'add' ? 'Ajouter un profil' : view === 'delete' ? 'Supprimer ce profil ?' : managing ? 'Gérer les profils' : 'Qui regarde ?';
      intro.textContent = view === 'list' ? managing ? 'Choisissez un profil pour le modifier.' : 'À chacun son univers.' : view === 'add' ? 'Un nouvel espace pour une nouvelle personne.' : 'Cette action est définitive.';
      cards.hidden = view !== 'list'; form.hidden = view !== 'add'; deletion.hidden = view !== 'delete';
      manage.hidden = managing || view !== 'list'; done.hidden = !managing || view !== 'list';
      dialog.querySelector('.viewer-footer').hidden = view !== 'list';
      retry.hidden = !state.error || view !== 'list';
      if (view !== 'list') { lock(); return; }
      const focusedId = cards.contains(document.activeElement) ? document.activeElement.closest('[data-profile-id]')?.dataset.profileId : null;
      cards.replaceChildren();
      for (const profile of store.all()) {
        const wrapper = document.createElement('div'); wrapper.className = 'viewer-card-wrap';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'viewer-card';
        button.dataset.profileId = profile.id;
        button.setAttribute('aria-label', `${managing ? 'Modifier' : 'Choisir'} le profil ${profile.displayName}`);
        button.setAttribute('aria-pressed', String(store.selected()?.id === profile.id));
        const visual = document.createElement('span'); visual.className = 'viewer-avatar';
        const image = document.createElement('img'); image.src = window.MovixModel.avatarSource(profile.photoURL); image.alt = '';
        image.addEventListener('error', () => { image.src = '/assets/avatar-neutral.svg'; }, { once: true });
        visual.append(image);
        if (managing) { const pencil = document.createElement('span'); pencil.className = 'viewer-edit-mark'; pencil.textContent = '✎'; pencil.setAttribute('aria-hidden', 'true'); visual.append(pencil); }
        const name = document.createElement('span'); name.className = 'viewer-name'; name.textContent = profile.displayName;
        button.append(visual, name);
        if (profile.primary) { const badge = document.createElement('span'); badge.className = 'viewer-primary-label'; badge.textContent = 'Principal'; button.append(badge); }
        button.addEventListener('click', () => { if (managing) edit(profile); else { store.select(profile.id); dialog.close(); } });
        wrapper.append(button);
        if (managing && !profile.primary) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'viewer-remove'; remove.textContent = 'Supprimer';
          remove.setAttribute('aria-label', `Supprimer le profil ${profile.displayName}`);
          remove.addEventListener('click', () => { deleting = profile; view = 'delete'; dialog.querySelector('#viewer-delete-description').textContent = `Le profil « ${profile.displayName} », son nom et son avatar seront supprimés. Votre compte reste inchangé.`; announce(''); draw(); dialog.querySelector('#viewer-cancel-delete').focus(); });
          wrapper.append(remove);
        }
        cards.append(wrapper);
      }
      if (store.all().length < state.maximum) {
        const add = document.createElement('button'); add.type = 'button'; add.id = 'viewer-add'; add.className = 'viewer-card viewer-add';
        const symbol = document.createElement('span'); symbol.className = 'viewer-add-symbol'; symbol.textContent = '+'; symbol.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.className = 'viewer-name'; text.textContent = 'Ajouter un profil'; add.append(symbol, text);
        add.dataset.unavailable = String(!state.ready); add.disabled = !state.ready;
        add.addEventListener('click', () => { view = 'add'; input.value = ''; announce(''); draw(); input.focus(); }); cards.append(add);
      }
      if (!busy) announce(state.loading ? 'Chargement de vos profils…' : state.error || '');
      lock();
      if (focusedId && !busy) [...cards.querySelectorAll('[data-profile-id]')].find(button => button.dataset.profileId === focusedId)?.focus();
    }
    function open() {
      if (!account()) { location.assign('/connexion.html?retour=compte.html'); return; }
      if (dialog.open) return;
      managing = false; view = 'list'; lastFocus = document.activeElement;
      dialog.showModal(); document.body.classList.add('viewer-dialog-open');
      announce(''); draw();
      cards.querySelector('button')?.focus();
      store.load().catch(() => {});
    }
    async function action(work, success) {
      if (busy) return;
      const uid = account()?.uid;
      busy = true; announce('Enregistrement…'); lock();
      try {
        const result = await work();
        if (account()?.uid !== uid) return;
        success(result);
      } catch (error) {
        if (account()?.uid !== uid) return;
        announce(error.code === 'PROFILE_LIMIT' ? 'Vous avez atteint la limite de cinq profils.' : 'Impossible d’enregistrer cette modification. Vérifiez votre connexion puis réessayez.');
      } finally { busy = false; lock(); }
    }
    document.addEventListener('click', event => {
      const link = event.target.closest('[data-switch-profile]');
      if (link) { event.preventDefault(); open(); }
    });
    dialog.querySelector('#viewer-close').addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('viewer-dialog-open');
      if (lastFocus?.isConnected) lastFocus.focus(); else document.querySelector('.account-trigger')?.focus();
    });
    dialog.addEventListener('click', event => {
      if (busy || event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    manage.addEventListener('click', () => { managing = true; announce(''); draw(); done.focus(); });
    done.addEventListener('click', () => { managing = false; announce(''); draw(); manage.focus(); });
    retry.addEventListener('click', () => store.load().catch(() => {}));
    dialog.querySelector('#viewer-cancel-add').addEventListener('click', () => { view = 'list'; announce(''); draw(); cards.querySelector('button')?.focus(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!input.value.trim() || input.value.trim().length > 60) { announce('Choisissez un nom de 1 à 60 caractères.'); input.focus(); return; }
      action(() => store.create(input.value.trim()), profile => { store.select(profile.id); dialog.close(); });
    });
    dialog.querySelector('#viewer-cancel-delete').addEventListener('click', () => { view = 'list'; deleting = null; announce(''); draw(); done.focus(); });
    dialog.querySelector('#viewer-confirm-delete').addEventListener('click', () => {
      if (deleting) action(() => store.remove(deleting.id), () => { deleting = null; view = 'list'; announce(''); draw(); done.focus(); });
    });
    window.MovixAccount.subscribe(user => {
      if (currentIdentity && currentIdentity !== user?.uid && dialog.open) dialog.close();
      currentIdentity = user?.uid || null;
      draw();
      if (user && location.pathname.endsWith('/compte.html') && location.hash === '#profils' && !hashOpened) { hashOpened = true; open(); }
    });
    window.addEventListener('hashchange', () => { if (location.hash === '#profils') open(); else hashOpened = false; });
    return { open };
  }
  window.MovixProfiles = { createStore, mount };
})();
