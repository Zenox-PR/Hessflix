// Loaded ONLY by the static demo build. No Firebase, tokens or network fallback.
(() => {
  const prefix = 'hessflix-demo:v1:';
  const memory = new Map();
  let storageError = false;
  function read(name, fallback) {
    if (memory.has(name)) return structuredClone(memory.get(name));
    try { return JSON.parse(localStorage.getItem(prefix + name) || 'null') ?? structuredClone(fallback); }
    catch { storageError = true; return structuredClone(fallback); }
  }
  function write(name, value) {
    memory.set(name, structuredClone(value));
    try { localStorage.setItem(prefix + name, JSON.stringify(value)); }
    catch { storageError = true; }
    announce();
    return !storageError;
  }
  const initialProfiles = [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Explorateur', photoURL: '' }];
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  async function request(input, options = {}) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = new URL(String(input), location.href);
    if (url.origin !== location.origin) return response({ error: 'DEMO_OFFLINE_ONLY' }, 403);
    const pathname = url.pathname, method = options.method || 'GET';
    const data = window.HessflixDemoCatalogue;
    if (pathname.startsWith('/api/catalogue') && method === 'GET') {
      if (!data) return response({ error: 'DEMO_CATALOGUE_UNAVAILABLE' }, 503);
      const suffix = pathname.slice('/api/catalogue'.length);
      if (suffix === '/featured') return response({ items: data.items.filter(item => ['movie-tt0816692', 'series-55138', 'jw-ts250831'].includes(item.id)).map(item => ({ ...item, featured: true, heroBackdrop: item.image })) });
      if (!suffix) {
        const state = { query: url.searchParams.get('query') || '', kind: url.searchParams.get('kind') || 'Tous' };
        let items = window.MovixModel.filterItems(data.items, state);
        const provider = url.searchParams.get('provider');
        if (provider) items = items.filter(item => item.platforms.includes(provider));
        return response({ items, nextCursor: null, stale: false });
      }
      const item = data.items.find(item => '/' + item.id === suffix);
      return item ? response({ item, stale: false }) : response({ error: 'DEMO_TITLE_NOT_FOUND' }, 404);
    }
    if (/^\/api\/profiles(?:\/[a-f0-9-]{36})?$/.test(pathname)) {
      if (!read('session', false)) return response({ error: 'DEMO_NOT_STARTED' }, 401);
      let profiles = read('profiles', initialProfiles);
      const id = pathname.split('/')[3];
      try {
        const payload = options.body ? JSON.parse(options.body) : {};
        if (method === 'POST') {
          if (profiles.length >= 4 || !window.MovixModel.validProfile(payload)) throw Error();
          profiles.push({ id: crypto.randomUUID(), ...payload });
        } else if (method === 'PATCH') {
          const profile = profiles.find(profile => profile.id === id);
          if (!profile) throw Error();
          const next = { displayName: profile.displayName, photoURL: profile.photoURL, ...payload };
          if (!window.MovixModel.validProfile(next)) throw Error();
          Object.assign(profile, next);
        } else if (method === 'DELETE') profiles = profiles.filter(profile => profile.id !== id);
        else if (method !== 'GET') throw Error();
        if (method !== 'GET') write('profiles', profiles);
        return response({ profiles });
      } catch { return response({ error: 'DEMO_INVALID_PROFILE' }, 400); }
    }
    // No real administration, playback, auth endpoint or remote API is available.
    return response({ error: 'DEMO_ROUTE_UNAVAILABLE' }, 404);
  }
  function announce() {
    const status = document.getElementById('demo-storage-status');
    if (status) { status.hidden = !storageError; status.textContent = 'Le navigateur ne permet pas la sauvegarde. Vos essais restent dans cet onglet et seront perdus à sa fermeture.'; }
  }
  function mount() {
    const banner = document.createElement('aside');
    banner.className = 'demo-banner'; banner.setAttribute('aria-label', 'Mode démonstration');
    banner.innerHTML = '<div><strong>DÉMONSTRATION INTERACTIVE</strong><p>Catalogue d’exemple · Profils fictifs · Listes enregistrées sur cet appareil uniquement</p></div><div class="demo-banner-actions"><a href="connexion.html" class="demo-start">Essayer la démo</a><a href="https://github.com/Zenox-PR/Hessflix" target="_blank" rel="noopener noreferrer">Voir le code ↗</a><button type="button" id="demo-reset">Réinitialiser la démo</button></div><p id="demo-storage-status" role="status" hidden></p>';
    document.body.prepend(banner);
    document.getElementById('demo-reset').addEventListener('click', () => {
      if (!confirm('Effacer uniquement les profils et les essais de cette démo sur cet appareil ?')) return;
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(prefix) || key.includes(':hessflix-demo-visitor:') || key.endsWith(':hessflix-demo-visitor')) localStorage.removeItem(key);
        }
        memory.clear(); location.href = 'index.html';
      } catch { storageError = true; announce(); }
    });
    announce();
  }
  window.HessflixDemo = { read, write, request, persistent: () => !storageError };
  window.addEventListener('storage', event => {
    if (event.key?.startsWith(prefix) || event.key === null) { memory.clear(); window.dispatchEvent(new Event('hessflix-personal-changed')); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
