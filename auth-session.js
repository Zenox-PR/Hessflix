(() => {
  const key = 'movix-server-logout-pending';
  /** @param {boolean} value */
  function mark(value) { try { if (value) sessionStorage.setItem(key, 'true'); else sessionStorage.removeItem(key); } catch { /* L'avertissement de cette page reste affichable sans stockage. */ } }
  let uncertain = false;
  function pending() { try { return uncertain || sessionStorage.getItem(key) === 'true'; } catch { return uncertain; } }
  /** @param {typeof fetch} request */
  async function clearServerSession(request = fetch) {
    const csrf = await request('/api/admin/csrf', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!csrf.ok) throw new Error('Session serveur indisponible');
    const data = /** @type {{csrfToken?: unknown}} */ (await csrf.json());
    if (typeof data.csrfToken !== 'string') throw new Error('Réponse serveur invalide');
    const response = await request('/api/admin/session', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': data.csrfToken }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Session serveur non supprimée');
    uncertain = false; mark(false);
  }
  /** @param {() => Promise<void>} localSignOut @param {typeof fetch} request @returns {Promise<import('./types/contracts').LogoutResult>} */
  async function signOut(localSignOut, request = fetch) {
    let serverCleared = false;
    try { await clearServerSession(request); serverCleared = true; }
    catch { uncertain = true; mark(true); }
    await localSignOut();
    return { serverCleared, localCleared: true };
  }
  const api = { pending, clearServerSession, signOut };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MovixSession = api;
})();
