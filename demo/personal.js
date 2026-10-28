// Same validated personal-data model, persisted synchronously in a demo-only namespace.
// No migration from real accounts, no network synchronization and no simulated cloud success.
(() => {
  const model = window.HessflixPersonalModel, demo = window.HessflixDemo;
  let account = null, connected = false;
  const key = () => 'activity:' + (account ? account.profileId || 'primary' : 'guest');
  const emit = () => window.dispatchEvent(new Event('hessflix-personal-changed'));
  function state() {
    const value = demo.read(key(), model.empty());
    return model.validState(value) ? value : model.empty();
  }
  function snapshot() { return { ...state(), identity: account ? account.uid + ':' + (account.profileId || 'primary') : null, persistent: demo.persistent(), syncStatus: 'local', pending: 0, rejectedCount: 0, profileReady: !account || account.profileReady !== false }; }
  async function enqueue(operation) {
    if (account?.profileReady === false) throw new Error('Attendez le chargement du profil.');
    const value = state(); model.apply(value, operation); value.revision++;
    demo.write(key(), value); emit(); return snapshot();
  }
  function setAccount(next) { account = next; emit(); }
  function connect() { if (!connected && window.MovixAccount) { connected = true; window.MovixAccount.subscribe(setAccount); } }
  window.HessflixPersonal = {
    connect, setAccount, snapshot, enqueue,
    message: () => demo.persistent() ? 'Démo : listes enregistrées dans ce navigateur uniquement, sans synchronisation entre appareils.' : 'Stockage indisponible : vos essais seront perdus à la fermeture de cet onglet.',
    sync: async () => { emit(); }, retryRejected: async () => {}, rejections: () => [],
    favorites: () => state().favorites, watchlist: () => state().watchlist, selection: id => state().selections?.[id],
    setFavorite: (id, value) => enqueue({ type: 'favorite', id, value }),
    setWatchlist: (id, value) => enqueue({ type: 'watchlist', id, value }),
    mark: (item, status, choice) => enqueue({ type: 'status', id: item.id, status, ...(choice ? { choice } : {}), ...(item.episodeCount != null ? { episodeCount: item.episodeCount } : {}), at: Date.now() }),
    removeProgress: id => enqueue({ type: 'removeProgress', id }),
    removeHistory: item => enqueue({ type: 'removeHistory', id: item.id, ...(item.choice ? { choice: item.choice } : {}) }),
    saveSelection: (id, choice) => enqueue({ type: 'selection', id, choice, at: Date.now() }),
    addTime: (start, end, day) => enqueue({ type: 'time', start, end, day })
  };
  queueMicrotask(connect);
  window.addEventListener('movix-auth-status', connect);
})();
