(() => {
  const button = document.querySelector('#admin-authorize');
  const message = document.querySelector('#admin-message');
  let busy = false;
  function state() {
    const user = window.MovixAccount?.getUser();
    const status = window.MovixAuthStatus?.state;
    button.disabled = busy || !user || status !== 'ready';
    if (!busy) message.textContent = status === 'error' ? 'Le service de connexion est indisponible. Rechargez la page.' : user ? 'Votre session est ouverte. Actualisez votre jeton pour faire vérifier vos droits.' : status === 'ready' ? 'Connectez-vous pour faire vérifier vos droits.' : 'Chargement de votre session…';
  }
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    state();
    message.textContent = 'Actualisation du jeton et vérification serveur…';
    try {
      const idToken = await window.MovixAccount.getIdToken(true);
      const csrfResponse = await fetch('/api/admin/csrf', { credentials: 'same-origin', cache: 'no-store' });
      if (!csrfResponse.ok) throw new Error('Vérification de la requête impossible.');
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch('/api/admin/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ idToken }) });
      const result = await response.json();
      if (!response.ok) {
        const errors = { ADMIN_REQUIRED: 'Ce compte ne possède pas les droits administrateur.', RECENT_LOGIN_REQUIRED: 'Reconnectez-vous pour ouvrir une session administrateur récente.', ADMIN_SERVER_NOT_CONFIGURED: 'Le serveur administrateur doit être configuré avec ses identifiants sécurisés.', INVALID_SESSION: 'Votre session est invalide ou expirée. Reconnectez-vous.' };
        throw new Error(errors[result.error] || 'Accès refusé. Vérifiez la configuration du serveur et vos droits.');
      }
      location.replace('/admin');
    } catch (error) {
      message.textContent = error.message || 'Accès indisponible pour le moment.';
    } finally { busy = false; button.disabled = !window.MovixAccount?.getUser(); }
  });
  window.MovixAccount?.subscribe(state);
  window.addEventListener('movix-auth-status', state);
  state();
})();
