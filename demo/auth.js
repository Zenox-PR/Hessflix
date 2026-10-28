// Demo identity is never an authentication credential and is never sent anywhere.
(() => {
  const demo = window.HessflixDemo;
  const listeners = new Set();
  const user = () => demo.read('session', false) ? {
    uid: 'hessflix-demo-visitor', ...demo.read('identity', { displayName: 'Cinéphile', photoURL: '' }),
    email: '', provider: 'demo', admin: false
  } : null;
  const publish = () => listeners.forEach(listener => listener(user()));
  const unavailable = async () => { throw new Error('Aucun compte réel dans la démonstration.'); };
  const adapter = {
    subscribe(callback) { listeners.add(callback); callback(user()); return () => listeners.delete(callback); },
    signInWithGoogle: unavailable, signInWithEmail: unavailable, createAccount: unavailable, sendPasswordReset: unavailable,
    async getIdToken() { return 'demo-local-only-not-an-auth-token'; },
    async refreshPermissions() { return false; },
    async updateDisplayName(displayName) {
      const identity = { ...demo.read('identity', { displayName: 'Cinéphile', photoURL: '' }), displayName: displayName.trim() };
      if (!window.MovixModel.validProfile(identity)) throw new Error('Nom de profil invalide.');
      demo.write('identity', identity); publish();
    },
    async updateAvatar(photoURL) {
      const identity = { ...demo.read('identity', { displayName: 'Cinéphile', photoURL: '' }), photoURL: photoURL || '' };
      if (!window.MovixModel.validProfile(identity)) throw new Error('Avatar invalide.');
      demo.write('identity', identity); publish();
    },
    async signOut() { demo.write('session', false); publish(); return { serverCleared: true, localCleared: true }; }
  };
  window.MovixAuthAdapter = adapter;
  window.MovixAccount?.connectAuth(adapter);
  window.MovixAuthStatus = { state: 'ready', code: 'demo-local' };
  window.dispatchEvent(new CustomEvent('movix-auth-status', { detail: window.MovixAuthStatus }));
  document.getElementById('demo-enter')?.addEventListener('click', () => {
    demo.write('session', true); publish();
    const target = new URLSearchParams(location.search).get('retour');
    const pages = ['index.html', 'compte.html', 'netflix.html', 'disney.html', 'prime-video.html', 'paramount.html', 'marvel.html'];
    location.href = pages.includes(target) || /^titre\.html\?id=(movie-tt\d+|series-\d+|jw-(tm|ts)\d+)$/.test(target || '') ? target : 'compte.html';
  });
})();
