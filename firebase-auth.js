// Configuration publique de l'application Web Firebase. Aucun secret administrateur ici.
(() => {
  const config = {
    apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
    authDomain: 'demo-hessflix.firebaseapp.com',
    projectId: 'demo-hessflix',
    storageBucket: 'demo-hessflix.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
    measurementId: 'G-EXAMPLE000'
  };
  /** @param {string} state @param {string} code */
  function status(state, code = '') {
    window.MovixAuthStatus = { state, code };
    window.dispatchEvent(new CustomEvent('movix-auth-status', { detail: window.MovixAuthStatus }));
  }
  /** @param {unknown} error */
  function errorCode(error) {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'auth/unknown-error';
  }
  if (!['http:', 'https:'].includes(location.protocol)) {
    status('unsupported-origin');
    return;
  }
  status('loading');
  Promise.all([
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')
  ]).then(([appSDK, authSDK]) => {
    const app = appSDK.getApps().find(app => app.name === '[DEFAULT]') || appSDK.initializeApp(config);
    const auth = authSDK.getAuth(app);
    auth.languageCode = 'fr';
    const provider = new authSDK.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    /** @type {Set<(user: import('firebase/auth').User | null) => Promise<void>>} */
    const profileListeners = new Set();
    /** @param {import('firebase/auth').User} user */
    function normaliseUser(user) {
      return {
        uid: user.uid,
        displayName: user.displayName || 'Profil',
        email: user.email || '',
        photoURL: user.photoURL || '',
        provider: user.providerData.some(item => item.providerId === 'google.com') ? 'google.com' : 'password'
      };
    }
    /** @param {{displayName?: string, photoURL?: string | null}} changes */
    async function saveCurrentProfile(changes) {
      if (!auth.currentUser) throw Object.assign(new Error('Connexion requise'), { code: 'auth/login-required' });
      const current = auth.currentUser;
      await authSDK.updateProfile(current, changes);
      if (auth.currentUser?.uid !== current.uid) throw new Error('Le compte connecté a changé.');
      await Promise.all([...profileListeners].map(publish => publish(auth.currentUser)));
    }
    /** @type {import('./types/contracts').AuthAdapter} */
    const adapter = {
      subscribe(callback) {
        let sequence = 0;
        /** @param {import('firebase/auth').User | null} user */
        const publish = async user => {
          const current = ++sequence;
          if (!user) { callback(null); return; }
          try {
            const result = await user.getIdTokenResult();
            if (current === sequence) callback({ ...normaliseUser(user), admin: result.claims.admin === true });
          } catch (error) {
            if (current === sequence) { callback(null); status('error', errorCode(error)); }
          }
        };
        profileListeners.add(publish);
        const stop = authSDK.onIdTokenChanged(auth, publish, error => {
          callback(null);
          status('error', errorCode(error));
        });
        return () => { sequence++; profileListeners.delete(publish); stop(); };
      },
      // L'appel popup reste directement lié au clic, sans attente préalable.
      signInWithGoogle() { return authSDK.signInWithPopup(auth, provider); },
      signInWithEmail(email, password) { return authSDK.signInWithEmailAndPassword(auth, email, password); },
      async createAccount(email, password, name) {
        const credential = await authSDK.createUserWithEmailAndPassword(auth, email, password);
        if (name.trim()) {
          try {
            await authSDK.updateProfile(credential.user, { displayName: name.trim() });
          } catch {
            // Le compte est déjà créé : ne pas proposer une seconde inscription.
          }
        }
        return credential;
      },
      sendPasswordReset(email) { return authSDK.sendPasswordResetEmail(auth, email); },
      getIdToken(forceRefresh = false) {
        if (!auth.currentUser) return Promise.reject(Object.assign(new Error('Connexion requise'), { code: 'auth/login-required' }));
        return auth.currentUser.getIdToken(forceRefresh);
      },
      async refreshPermissions() {
        if (!auth.currentUser) throw new Error('Connexion requise');
        await auth.currentUser.getIdToken(true);
        return (await auth.currentUser.getIdTokenResult()).claims.admin === true;
      },
      async updateAvatar(photoURL) {
        if (photoURL !== null && (!photoURL || !window.MovixModel.validPhotoURL(photoURL))) throw new TypeError('Avatar invalide');
        await saveCurrentProfile({ photoURL });
      },
      async updateDisplayName(displayName) {
        if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(displayName)) throw Object.assign(new Error('Le nom doit contenir entre 1 et 60 caractères.'), { code: 'auth/invalid-display-name' });
        await saveCurrentProfile({ displayName: displayName.trim() });
      },
      async signOut() {
        return window.MovixSession.signOut(() => authSDK.signOut(auth));
      }
    };
    window.MovixAuthAdapter = adapter;
    window.MovixAccount?.connectAuth(adapter);
    status('ready');
    // Analytics n'est pas initialisé : ce module sert uniquement à la connexion.
  }).catch(error => status('error', error.code || 'auth/sdk-load-failed'));
})();
