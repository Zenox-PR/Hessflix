window.MovixProfilePage = ({ activeUser, setAvatar, providerLabel }) => {
  if (document.querySelector('#account-content')) {
    const editName = document.querySelector('#edit-profile-name');
    const nameForm = document.querySelector('#profile-name-form');
    const nameInput = document.querySelector('#profile-name-input');
    const saveName = document.querySelector('#save-profile-name');
    const cancelName = document.querySelector('#cancel-profile-name');
    const nameStatus = document.querySelector('#profile-name-status');
    let savingName = false;
    let editingUID = null;
    let editingProfile = null;
    function nameControls() {
      editName.hidden = !activeUser();
      editName.disabled = savingName;
      nameInput.disabled = savingName;
      saveName.disabled = savingName;
      cancelName.disabled = savingName;
      saveName.textContent = savingName ? 'Enregistrement…' : 'Enregistrer';
      nameForm.setAttribute('aria-busy', String(savingName));
    }
    function closeNameEditor(restoreFocus = true) {
      nameForm.hidden = true;
      editName.setAttribute('aria-expanded', 'false');
      nameInput.value = '';
      editingUID = null;
      editingProfile = null;
      if (restoreFocus && activeUser()) editName.focus();
    }
    editName.addEventListener('click', () => {
      const account = activeUser();
      if (!account || savingName) return;
      if (!nameForm.hidden) { closeNameEditor(); return; }
      editingUID = account.uid;
      editingProfile = account.profileId || 'primary';
      nameInput.value = account.displayName || '';
      nameInput.removeAttribute('aria-invalid');
      nameStatus.hidden = true;
      nameForm.hidden = false;
      editName.setAttribute('aria-expanded', 'true');
      nameInput.focus();
      nameInput.select();
    });
    cancelName.addEventListener('click', () => { if (!savingName) { closeNameEditor(); nameStatus.hidden = true; } });
    nameInput.addEventListener('input', () => { nameStatus.hidden = true; nameInput.removeAttribute('aria-invalid'); });
    nameForm.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !savingName) { event.preventDefault(); closeNameEditor(); nameStatus.hidden = true; }
    });
    nameForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (savingName || !activeUser() || editingUID !== activeUser().uid || editingProfile !== (activeUser().profileId || 'primary')) return;
      const displayName = nameInput.value.trim();
      if (!displayName || displayName.length > 60 || /[\u0000-\u001f\u007f]/.test(displayName)) {
        nameStatus.textContent = 'Choisissez un nom de 1 à 60 caractères.';
        nameStatus.dataset.state = 'error';
        nameStatus.hidden = false;
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.focus();
        return;
      }
      const uid = editingUID;
      const profileId = editingProfile;
      savingName = true;
      nameStatus.hidden = true;
      nameControls();
      try {
        await window.MovixAccount.updateDisplayName(displayName);
        if (activeUser()?.uid !== uid || (activeUser().profileId || 'primary') !== profileId) return;
        closeNameEditor(false);
        nameStatus.textContent = 'Votre nom de profil est enregistré.';
        nameStatus.dataset.state = 'success';
        nameStatus.hidden = false;
      } catch {
        if (activeUser()?.uid !== uid || (activeUser().profileId || 'primary') !== profileId) return;
        nameStatus.textContent = 'Impossible d’enregistrer le nom. Vérifiez votre connexion puis réessayez.';
        nameStatus.dataset.state = 'error';
        nameStatus.hidden = false;
      } finally {
        savingName = false;
        nameControls();
        if (activeUser()?.uid === uid && (activeUser().profileId || 'primary') === profileId) { if (nameForm.hidden) editName.focus(); else nameInput.focus(); }
      }
    });
    const dashboard=window.HessflixProfileDashboard?.mount({activeUser});
    const sections = {
      profils: ['Changer de profil', 'Votre espace, votre personnalité.', 'Choisissez ou ajoutez un profil depuis la fenêtre « Qui regarde ? ».'],
      profil: ['Mon profil', 'Votre prochaine histoire vous attend.', 'Retrouvez vos titres et reprenez le fil de vos envies.'],
      'a-voir': ['À voir', 'Vos prochaines histoires.', 'Les films et séries que vous souhaitez découvrir.'],
      'en-cours': ['En cours', 'On reprend là où vous en étiez ?', 'Les films et épisodes de votre suivi qui restent à terminer.'],
      visionnes: ['Visionnés', 'Votre historique', 'Les films et épisodes que vous avez marqués comme vus.'],
      temps: ['Mon activité', 'Du temps pour vos histoires.', 'Le temps passé à utiliser Hessflix, indépendamment des vidéos.'],
      favoris: ['Favoris', 'Gardez vos coups de cœur à portée de main.', 'Vos titres favoris apparaîtront ici.'],
      'deja-vu': ['Déjà vu', 'Vos histoires ont une mémoire.', 'Retrouvez ici les titres que vous avez déjà regardés.'],
      parametres: ['Réglages', 'Votre profil, simplement.', 'Personnalisez votre nom et votre avatar, ou choisissez un autre profil.'],
      vip: ['L’expérience VIP', 'Encore plus de cinéma, à votre façon.', 'L’offre VIP sera présentée ici lorsqu’elle sera disponible.']
    };
    function renderSection() {
      const key = Object.hasOwn(sections, location.hash.slice(1)) ? location.hash.slice(1) : 'profil';
      const [title, subtitle, description] = sections[key];
      const account = activeUser();
      if (editingUID && (editingUID !== account?.uid || editingProfile !== (account?.profileId || 'primary'))) { closeNameEditor(false); nameStatus.hidden = true; }
      nameControls();
      document.title = `${title} — Hessflix`;
      document.querySelector('#account-page-title').textContent = title;
      document.querySelector('#account-page-subtitle').textContent = subtitle;
      document.querySelector('#account-page-description').textContent = description;
      document.querySelector('#account-session-label').textContent = account ? providerLabel(account) : 'Vous êtes déconnecté';
      document.querySelector('#account-page-name').textContent = account?.displayName || 'Votre profil';
      setAvatar(document.querySelector('#account-page-avatar'), account);
      document.querySelector('#account-connect').hidden = Boolean(account);
      document.querySelectorAll('[data-account-section]').forEach(link => { if (link.dataset.accountSection === key) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
      dashboard?.render(key);
    }
    window.addEventListener('hashchange', renderSection);
    window.MovixAccount.subscribe(renderSection);
  }

};
