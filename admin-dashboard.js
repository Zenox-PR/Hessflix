(() => {
  let checking = false;
  async function verify() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const response = await fetch('/api/admin/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { location.replace('/admin'); return; }
      const result = await response.json();
      document.querySelector('#admin-server-state').textContent = 'Validée par le serveur';
      document.querySelector('#admin-project').textContent = result.projectId;
      document.querySelector('#admin-uid').textContent = result.uid;
    } catch { document.querySelector('#admin-server-state').textContent = 'Serveur indisponible'; }
    finally { checking = false; }
  }
  let hadUser = false;
  window.MovixAccount?.subscribe(user => {
    if (user) hadUser = true;
    else if (hadUser) location.replace('/admin');
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('visibilitychange', verify);
  verify();
})();
