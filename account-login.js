/** @param {{ getAdapter: () => import('./types/contracts').AuthAdapter | null, returnPage: string }} options */
window.MovixLogin = ({ getAdapter, returnPage }) => {
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    const message = document.querySelector('#login-message');
    const emailInput = document.querySelector('#login-email');
    const passwordInput = document.querySelector('#login-password');
    const nameInput = document.querySelector('#signup-name');
    const confirmInput = document.querySelector('#signup-confirm');
    const submitButton = loginForm.querySelector('button[type="submit"]');
    const googleButton = document.querySelector('#google-signin');
    const resetButton = document.querySelector('#reset-password');
    const showMessage = text => { message.textContent = text; message.hidden = false; };
    let mode = 'login';
    let busy = false;
    function authError(error) {
      const messages = {
        'auth/operation-not-allowed': 'Ce mode de connexion doit être activé dans Firebase Authentication.',
        'auth/configuration-not-found': 'Activez Authentication puis Google et E-mail/Mot de passe dans la console Firebase.',
        'auth/unauthorized-domain': 'Cette adresse doit être ajoutée aux domaines autorisés de Firebase Authentication.',
        'auth/popup-blocked': 'Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres pour ce site puis réessayez.',
        'auth/popup-closed-by-user': 'La fenêtre Google a été fermée. Vous pouvez réessayer.',
        'auth/cancelled-popup-request': 'Une autre fenêtre de connexion est déjà ouverte.',
        'auth/network-request-failed': 'Connexion réseau impossible. Vérifiez votre accès Internet.',
        'auth/too-many-requests': 'Trop de tentatives. Patientez un moment avant de réessayer.',
        'auth/invalid-email': 'Vérifiez le format de votre adresse e-mail.',
        'auth/weak-password': 'Choisissez un mot de passe plus robuste, avec au moins 6 caractères.',
        'auth/password-does-not-meet-requirements': 'Le mot de passe ne respecte pas les critères de sécurité de ce service.',
        'auth/email-already-in-use': 'Impossible de créer ce compte. Essayez de vous connecter ou de réinitialiser votre mot de passe.',
        'auth/account-exists-with-different-credential': 'Utilisez le mode de connexion associé à votre compte.',
        'auth/web-storage-unsupported': 'Autorisez le stockage du navigateur pour vous connecter.'
      };
      return messages[error?.code] || 'Connexion impossible. Vérifiez vos informations ou réessayez dans un instant.';
    }
    function refreshControls() {
      const state = window.MovixAuthStatus?.state || 'loading';
      const available = Boolean(getAdapter()) && state === 'ready';
      submitButton.disabled = busy || !available;
      googleButton.disabled = busy || !available;
      resetButton.disabled = busy || !available;
      document.querySelectorAll('[data-auth-mode]').forEach(button => { button.disabled = busy; });
      if (state === 'unsupported-origin') showMessage('Pour vous connecter, lancez « Ouvrir Hessflix.cmd » et ouvrez http://localhost:4180. La connexion ne fonctionne pas en ouvrant directement un fichier HTML.');
      else if (state === 'error') showMessage('Le service de connexion est indisponible. Vérifiez votre accès Internet puis rechargez la page.');
      else if (state === 'loading') showMessage('Chargement du service de connexion…');
      else if (!busy) message.hidden = true;
    }
    function clearPasswords() {
      passwordInput.value = '';
      confirmInput.value = '';
      passwordInput.type = 'password';
      document.querySelector('#toggle-password').textContent = 'Afficher';
      document.querySelector('#toggle-password').setAttribute('aria-pressed', 'false');
    }
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => {
      mode = button.dataset.authMode;
      const signingUp = mode === 'signup';
      document.querySelectorAll('[data-auth-mode]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
      document.querySelectorAll('[data-signup-only]').forEach(field => { field.hidden = !signingUp; });
      nameInput.required = signingUp;
      confirmInput.required = signingUp;
      confirmInput.disabled = !signingUp;
      nameInput.disabled = !signingUp;
      passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
      passwordInput.minLength = signingUp ? 6 : 1;
      submitButton.textContent = signingUp ? 'Créer mon compte' : 'Se connecter';
      document.querySelector('#login-title').textContent = signingUp ? 'Votre univers commence ici.' : 'Ravi de vous revoir.';
      resetButton.hidden = signingUp;
      clearPasswords();
      message.hidden = true;
      refreshControls();
    }));
    async function signIn(method, email, password) {
      if (busy) return;
      if (!getAdapter() || window.MovixAuthStatus?.state !== 'ready') { refreshControls(); return; }
      if (method === 'email' && mode === 'signup' && password !== confirmInput.value) {
        showMessage('Les deux mots de passe doivent être identiques.');
        confirmInput.focus();
        return;
      }
      busy = true;
      refreshControls();
      message.hidden = true;
      try {
        if (method === 'google') await getAdapter().signInWithGoogle();
        else if (mode === 'signup') await getAdapter().createAccount(email, password, nameInput.value.trim());
        else await getAdapter().signInWithEmail(email, password);
        location.assign(returnPage);
      } catch (error) {
        busy = false;
        refreshControls();
        showMessage(authError(error));
      } finally {
        busy = false;
        const available = Boolean(getAdapter()) && window.MovixAuthStatus?.state === 'ready';
        submitButton.disabled = !available;
        googleButton.disabled = !available;
        resetButton.disabled = !available;
        document.querySelectorAll('[data-auth-mode]').forEach(button => { button.disabled = false; });
        clearPasswords();
      }
    }
    loginForm.addEventListener('submit', event => {
      event.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      signIn('email', email, password);
      if (!getAdapter()) clearPasswords();
    });
    document.querySelector('#google-signin').addEventListener('click', () => signIn('google'));
    document.querySelector('#toggle-password').addEventListener('click', event => {
      const input = document.querySelector('#login-password');
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      event.currentTarget.textContent = showing ? 'Masquer' : 'Afficher';
      event.currentTarget.setAttribute('aria-pressed', String(showing));
    });
    resetButton.addEventListener('click', async () => {
      if (busy || !getAdapter()) return;
      if (!emailInput.value.trim() || !emailInput.checkValidity()) {
        showMessage('Indiquez votre adresse e-mail ci-dessus pour réinitialiser le mot de passe.');
        emailInput.focus();
        return;
      }
      busy = true;
      refreshControls();
      try {
        await getAdapter().sendPasswordReset(emailInput.value.trim());
        busy = false;
        refreshControls();
        showMessage('Si un compte correspond à cette adresse, vous recevrez un e-mail pour réinitialiser votre mot de passe.');
      } catch (error) {
        busy = false;
        refreshControls();
        showMessage(authError(error));
      } finally { busy = false; clearPasswords(); }
    });
    window.addEventListener('movix-auth-status', refreshControls);
    window.addEventListener('pageshow', clearPasswords);
    refreshControls();
    document.querySelector('#login-back').href = returnPage;
  }


};
