// Cache et journal durable par UID/profil. Les anciennes clés restent intactes après migration.
(() => {
  const model = window.HessflixPersonalModel;
  const contexts = new Map();
  const timers = new Map();
  const MAX_PENDING = 2000;
  let owner = null;
  let active = null;
  let connected = false;

  function emit() {
    window.dispatchEvent(new Event('hessflix-personal-changed'));
    window.dispatchEvent(new Event('hessflix-activity-changed'));
  }

  function same(account, context) {
    return account && account.uid === context.uid && (account.profileId || 'primary') === context.profile;
  }

  function context(account) {
    const uid = account?.uid || 'guest';
    const profile = account?.profileId || 'primary';
    const key = `hessflix-personal-v1:${uid}:${profile}`;
    if (!contexts.has(key)) {
      contexts.set(key, {
        uid, profile, key, persistent: true, corrupt: false,
        status: uid === 'guest' ? 'guest' : 'loading', memory: null,
        loaded: false, task: null, intentMemory: new Map(), intentClock: 0
      });
    }
    return contexts.get(key);
  }

  function emptyRecord() {
    return {
      device: crypto.randomUUID(), next: 1, base: model.empty(),
      pending: [], rejected: [], intentReceipts: [], migrated: false, sending: 0
    };
  }

  function validateSequence(operation, next) {
    model.validate(operation);
    if (!Number.isSafeInteger(operation.seq) || operation.seq < 1 || operation.seq >= next) {
      throw new Error('Journal invalide');
    }
  }

  function read(current) {
    if (!current.persistent && current.memory) return structuredClone(current.memory);
    let raw;
    try {
      raw = localStorage.getItem(current.key);
      const record = raw ? JSON.parse(raw) : emptyRecord();
      record.rejected ??= [];
      record.intentReceipts ??= [];
      if (!record || !Array.isArray(record.pending) || record.pending.length > MAX_PENDING ||
          !Number.isSafeInteger(record.next) || record.next < 1 ||
          !/^[a-f0-9-]{36}$/.test(record.device) || !model.validState(record.base) ||
          !Array.isArray(record.rejected) || record.rejected.length > MAX_PENDING ||
          !Array.isArray(record.intentReceipts) || record.intentReceipts.length > MAX_PENDING ||
          record.intentReceipts.some(id => !/^[a-f0-9-]{36}$/.test(id))) {
        throw new Error('Cache invalide');
      }
      for (const operation of record.pending) validateSequence(operation, record.next);
      for (const refusal of record.rejected) {
        if (!refusal || !model.isTerminalRejection(refusal.reason)) throw new Error('Refus invalide');
        validateSequence(refusal.operation, record.next);
      }
      current.memory = record;
      return structuredClone(record);
    } catch {
      // Never overwrite a malformed original automatically. A temporary quota/access error,
      // unlike corruption, can be retried when the next save becomes possible.
      current.corrupt ||= raw != null;
      current.persistent = false;
      return structuredClone(current.memory || emptyRecord());
    }
  }

  function save(current, record) {
    current.memory = structuredClone(record);
    let persisted = false;
    if (!current.corrupt) {
      try {
        localStorage.setItem(current.key, JSON.stringify(record));
        persisted = true;
      } catch { /* Memory keeps the latest choices while browser storage is unavailable. */ }
    }
    current.persistent = persisted;
    if (current === active) emit();
    return persisted;
  }

  function withLock(current, work) {
    return navigator.locks
      ? navigator.locks.request(`hessflix-personal-local:${current.key}`, work)
      : Promise.resolve().then(work);
  }

  function projectedState(record) {
    const state = structuredClone(record.base);
    for (const operation of record.pending) {
      try { model.apply(state, operation); }
      catch (error) {
        // An addition can become invalid after another device fills the list. It must not
        // prevent a later removal from being displayed or entering the ordered outbox.
        if (!model.isTerminalRejection(error)) throw error;
      }
    }
    return state;
  }

  const intentPrefix = current => `hessflix-personal-intent-v1:${current.uid}:${current.profile}:`;

  function intents(current) {
    const result = new Map(current.intentMemory), prefix = intentPrefix(current);
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue;
        const id = key.slice(prefix.length);
        try {
          const value = JSON.parse(localStorage.getItem(key));
          if (!/^[a-f0-9-]{36}$/.test(id) || value.id !== id || value.version !== 1 ||
              !Number.isSafeInteger(value.order) || value.order < 0) throw new Error('Invalid intent');
          model.validate(value.operation);
          result.set(id, value);
        } catch { current.intentError = 'Une modification locale illisible est conservée sans import automatique.'; }
      }
    } catch { /* In-memory intents remain available if browser storage is denied. */ }
    return [...result.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  function stageIntent(current, operation) {
    // Independent keys avoid cross-tab read/modify/write races. Persist before
    // the first await: navigation may destroy a queued Web Locks callback.
    const record = read(current), waiting = intents(current);
    if (record.pending.length + waiting.length >= MAX_PENDING) {
      throw new Error('Trop de modifications en attente : reconnectez-vous avant de continuer.');
    }
    const preview = projectedState(record), accepted = new Set(record.intentReceipts);
    for (const value of waiting) if (!accepted.has(value.id)) {
      try { model.apply(preview, value.operation); }
      catch (error) { if (!model.isTerminalRejection(error)) throw error; }
    }
    model.apply(preview, operation);
    const intent = { version: 1, id: crypto.randomUUID(),
      order: current.intentClock = Math.max(Date.now(), current.intentClock + 1),
      operation: structuredClone(operation) };
    current.intentMemory.set(intent.id, intent);
    try { localStorage.setItem(intentPrefix(current) + intent.id, JSON.stringify(intent)); }
    catch { current.persistent = false; }
    return intent;
  }

  async function drainIntents(current) {
    return withLock(current, () => {
      const waiting = intents(current);
      if (!waiting.length) return;
      const record = read(current), accepted = new Set(record.intentReceipts);
      const liveIds = new Set(waiting.map(value => value.id));
      // Receipts make recovery idempotent if a page dies after saving the main
      // journal but before removing its independent write-ahead entry.
      record.intentReceipts = record.intentReceipts.filter(id => liveIds.has(id));
      const completed = [];
      for (const intent of waiting) {
        if (accepted.has(intent.id)) { completed.push(intent.id); continue; }
        if (record.intentReceipts.length >= MAX_PENDING || record.pending.length >= MAX_PENDING) break;
        if (current.uid === 'guest') {
          try { model.apply(record.base, intent.operation); }
          catch (error) {
            if (!model.isTerminalRejection(error) || record.rejected.length >= MAX_PENDING) throw error;
            record.rejected.push({ operation: { ...intent.operation, seq: record.next++ }, reason: error.code, rejectedAt: Date.now() });
            current.writeError = model.rejectionMessage(error.code);
          }
        } else {
          const operation = intent.operation, previous = record.pending.at(-1);
          if (operation.type === 'time' && previous?.type === 'time' && previous.seq > record.sending &&
              previous.day === operation.day && previous.end === operation.start && operation.end - previous.start <= 300000) {
            previous.end = operation.end;
          } else record.pending.push({ ...operation, seq: record.next++ });
        }
        record.intentReceipts.push(intent.id);
        completed.push(intent.id);
      }
      const persisted = save(current, record);
      // Never delete the write-ahead entry when committing the journal failed.
      if (persisted) for (const id of completed) {
        try { localStorage.removeItem(intentPrefix(current) + id); current.intentMemory.delete(id); }
        catch { /* A retained entry is deduplicated by its receipt on recovery. */ }
      }
    });
  }

  function view(current = active) {
    if (!current) current = active = context(null);
    const record = read(current);
    return {
      ...projectedState(record),
      identity: current.uid === 'guest' ? null : `${current.uid}:${current.profile}`,
      persistent: current.persistent, syncStatus: current.status,
      pending: record.pending.length, rejectedCount: record.rejected.length,
      profileReady: !owner || owner.profileReady !== false
    };
  }

  function refusalMessage(record) {
    if (!record.rejected.length) return '';
    const reason = model.rejectionMessage(record.rejected[0].reason);
    return `${record.rejected.length} modification(s) refusée(s), conservée(s) séparément. ${reason} Retirez un titre puis réessayez les modifications refusées.`;
  }

  function statusMessage() {
    const state = view();
    const record = read(active);
    if (!state.persistent) return 'Stockage indisponible : gardez cet onglet ouvert pour ne pas perdre les modifications en attente.';
    if (owner?.profileReady === false) return 'Chargement de vos profils…';
    if (!owner) return 'Mode visiteur : listes sur cet appareil, sans synchronisation.';
    if (active.syncError === 'LOGIN_REQUIRED') return 'Connexion expirée : reconnectez-vous. Vos modifications restent en attente pour ce profil.';
    if (active.syncError === 'PERSONAL_SEQUENCE_CONFLICT') return 'Conflit de synchronisation : vos modifications sont conservées. Ne videz pas les données du navigateur ; un diagnostic est nécessaire.';
    if (active.syncError === 'PERSONAL_DEVICE_LIMIT') return 'Limite d’appareils atteinte : vos modifications restent en attente. Un diagnostic est nécessaire.';
    if (state.syncStatus === 'blocked') return 'Ce profil n’est plus accessible. Les modifications restent en attente pour ce profil uniquement.';
    if (state.pending || state.syncStatus === 'offline') return 'Synchronisation en attente : vos modifications sont conservées sur cet appareil. Réessayez à la reconnexion.';
    if (record.rejected.length) return `Les autres modifications sont synchronisées. ${refusalMessage(record)}`;
    return state.syncStatus === 'loading' ? 'Chargement de vos listes…' : 'Vos listes sont synchronisées pour ce profil.';
  }

  async function enqueue(operation, current = active) {
    if (!current) current = active = context(null);
    if (current === active && owner?.profileReady === false) {
      throw new Error('Attendez le chargement du profil avant de modifier ses listes.');
    }
    model.validate(operation);
    try {
      stageIntent(current, operation);
      await drainIntents(current);
    } catch (error) {
      if (model.isTerminalRejection(error)) error.message = model.rejectionMessage(error.code);
      current.writeError = error.message;
      if (current === active) emit();
      throw error;
    }
    current.writeError = '';
    if (current.uid !== 'guest' && operation.type !== 'time') schedule(current);
    return view(current);
  }

  function schedule(current, delay = 350) {
    clearTimeout(timers.get(current.key));
    timers.set(current.key, setTimeout(() => { void sync(current); }, delay));
  }

  async function request(current, method, body) {
    if (!same(window.MovixAccount?.getUser(), current)) throw new Error('ACCOUNT_CHANGED');
    const token = await window.MovixAccount.getIdToken();
    if (!same(window.MovixAccount.getUser(), current)) throw new Error('ACCOUNT_CHANGED');
    const response = await fetch(`/api/personal/${encodeURIComponent(current.profile)}`, {
      method, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(result.error || 'PERSONAL_UNAVAILABLE'), {
        status: response.status, rejection: result.rejection
      });
    }
    if (!model.validState(result.state)) throw new Error('INVALID_RESPONSE');
    return result.state;
  }

  async function migration(current) {
    if (current.uid === 'guest' || owner?.profileReady === false || read(current).migrated) return;
    const suffix = `${current.uid}:${current.profile}`;
    let data = { favorites: [], watchlist: [], progress: [], history: [], seconds: 0, days: {}, selections: [] };
    try {
      for (const [name, prefix] of [['favorites', 'movix-favorites-v1:'], ['watchlist', 'movix-watchlist-v1:']]) {
        const values = JSON.parse(localStorage.getItem(prefix + suffix) || '[]');
        if (!Array.isArray(values)) throw new Error('Anciennes données invalides');
        data[name] = values.filter(model.validId).slice(0, 500);
      }
      const old = JSON.parse(localStorage.getItem(`hessflix-activity-v1:${suffix}`) || 'null');
      if (old) data = { ...data, progress: old.progress, history: old.history, seconds: old.seconds, days: old.days };
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        const tmdbPrefix = `hessflix-tmdb-episode-v1:${suffix}:`;
        const legacyPrefix = `hessflix-episode-choice-v1:${suffix}:`;
        if (!key.startsWith(tmdbPrefix) && !key.startsWith(legacyPrefix)) continue;
        const value = JSON.parse(localStorage.getItem(key));
        const id = key.startsWith(tmdbPrefix) ? `tmdb-tv-${key.slice(tmdbPrefix.length)}` : key.slice(legacyPrefix.length);
        if (model.validId(id) && value) data.selections.push({ id, choice: { season: value.season, episode: value.number } });
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
      const source = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const operation = { type: 'import', source, data };
      model.validate(operation);
      if (!read(current).pending.some(value => value.type === 'import' && value.source === source)) {
        await enqueue(operation, current);
      }
      current.migrationError = false;
      await withLock(current, () => {
        const latest = read(current);
        latest.migrated = true;
        save(current, latest);
      });
    } catch {
      current.migrationError = true;
      if (current === active) emit();
    }
  }

  async function mergeServerState(current, state) {
    await withLock(current, () => {
      const record = read(current);
      if (state.revision >= (record.base.revision || 0)) record.base = state;
      const acknowledged = state.cursors?.[record.device] || 0;
      record.pending = record.pending.filter(operation => operation.seq > acknowledged);
      record.next = Math.max(record.next, acknowledged + 1);
      record.sending = 0;
      save(current, record);
    });
  }

  async function prepareBatch(current) {
    let sending;
    await withLock(current, () => {
      const record = read(current);
      sending = { device: record.device, operations: record.pending.slice(0, 50) };
      record.sending = sending.operations.at(-1)?.seq || 0;
      save(current, record);
    });
    return sending;
  }

  async function retireRejectedOperation(current, sending, error) {
    const refusal = error.rejection;
    if (error.status !== 409 || error.message !== 'PERSONAL_OPERATION_REJECTED' ||
        !Number.isSafeInteger(refusal?.seq) || !model.isTerminalRejection(refusal.reason) ||
        !sending.operations.some(operation => operation.seq === refusal.seq && operation.type !== 'skip')) {
      return false;
    }
    await withLock(current, () => {
      const original = read(current);
      const record = structuredClone(original);
      const index = record.pending.findIndex(operation => operation.seq === refusal.seq);
      if (index < 0 || record.pending[index].type === 'skip') return;
      if (record.rejected.length >= MAX_PENDING) {
        throw new Error('Trop de modifications refusées sont conservées. Gardez cet onglet ouvert et demandez un diagnostic.');
      }
      const operation = record.pending[index];
      record.rejected.push({ operation, reason: refusal.reason, rejectedAt: Date.now() });
      // Do not renumber later operations or drop a sequence: the no-op acknowledges only
      // this refusal. Its full intent is saved in the SAME localStorage write first.
      record.pending[index] = { type: 'skip', seq: operation.seq };
      if (!save(current, record)) {
        // Without a durable rejection archive, advancing the cloud cursor would make
        // an old cache unable to recover that rejected intent after a reload.
        current.memory = original;
        current.writeError = 'Impossible de conserver le refus sur cet appareil. Les modifications restent en attente ; rétablissez le stockage du navigateur.';
        if (current === active) emit();
        throw new Error('PERSONAL_REJECTION_NOT_PERSISTED');
      }
      current.writeError = '';
    });
    return true;
  }

  function sync(current = active) {
    if (!current || current.uid === 'guest' || !same(owner, current) || owner?.profileReady === false) return Promise.resolve();
    if (current.task) return current.task;
    const work = async () => {
      try {
        current.status = 'loading';
        current.syncError = '';
        if (current === active) emit();
        await drainIntents(current);
        await migration(current);
        await mergeServerState(current, await request(current, 'GET'));
        for (let batch = 0; batch < 100 && same(owner, current); batch++) {
          await drainIntents(current);
          const sending = await prepareBatch(current);
          if (!sending.operations.length) break;
          try {
            await mergeServerState(current, await request(current, 'POST', sending));
          } catch (error) {
            if (!await retireRejectedOperation(current, sending, error)) throw error;
          }
        }
        current.status = read(current).pending.length ? 'offline' : 'synced';
        current.loaded = true;
      } catch (error) {
        current.syncError = error.message;
        current.status = error.status === 404 || error.status === 403 ? 'blocked' : 'offline';
      } finally {
        current.task = null;
        if (current === active) emit();
      }
    };
    current.task = navigator.locks
      ? navigator.locks.request(`hessflix-personal-network:${current.key}`, work)
      : Promise.resolve().then(work);
    return current.task;
  }

  async function retryRejected() {
    const current = active;
    if (!current || current.uid === 'guest' || owner?.profileReady === false) return;
    let retryCount = 0;
    await withLock(current, () => {
      const record = read(current);
      const preview = projectedState(record);
      const remaining = [];
      for (const refusal of record.rejected) {
        const { seq, ...operation } = refusal.operation;
        try {
          if (record.pending.length >= MAX_PENDING) throw new Error('Journal plein');
          model.apply(preview, operation);
          record.pending.push({ ...operation, seq: record.next++ });
          retryCount++;
        } catch { remaining.push(refusal); }
      }
      record.rejected = remaining;
      save(current, record);
      current.writeError = !retryCount && remaining.length
        ? 'Aucun refus ne peut encore être repris. Libérez de la place dans la liste concernée puis réessayez.' : '';
    });
    if (current === active) emit();
    if (retryCount) await sync(current);
  }

  function setAccount(account) {
    owner = account;
    const next = context(account);
    if (next !== active) { active = next; emit(); }
    if (!account) {
      const record = read(next);
      if (!record.migrated) {
        try { record.base.favorites = JSON.parse(localStorage.getItem('movix-favorites-v1:guest:primary') || '[]').filter(model.validId); }
        catch { /* Never import an invalid legacy source. */ }
        record.migrated = true;
        save(next, record);
      }
      void drainIntents(next).catch(error => { next.writeError = error.message; if (next === active) emit(); });
    } else if (account.profileReady !== false) schedule(next, 0);
    else emit();
  }

  function connect() {
    if (connected || !window.MovixAccount) return;
    connected = true;
    window.MovixAccount.subscribe(setAccount);
  }

  window.HessflixPersonal = {
    connect, setAccount, snapshot: () => view(), message: statusMessage,
    sync: () => sync(), retryRejected, enqueue,
    rejections: () => structuredClone(read(active).rejected),
    favorites: () => view().favorites,
    watchlist: () => view().watchlist,
    selection: id => view().selections?.[id],
    setFavorite: (id, value) => enqueue({ type: 'favorite', id, value }),
    setWatchlist: (id, value) => enqueue({ type: 'watchlist', id, value }),
    mark: (item, status, choice) => enqueue({
      type: 'status', id: item.id, status, ...(choice ? { choice } : {}),
      ...(item.episodeCount != null ? { episodeCount: item.episodeCount } : {}), at: Date.now()
    }),
    removeProgress: id => enqueue({ type: 'removeProgress', id }),
    removeHistory: item => enqueue({ type: 'removeHistory', id: item.id, ...(item.choice ? { choice: item.choice } : {}) }),
    saveSelection: (id, choice) => enqueue({ type: 'selection', id, choice, at: Date.now() }),
    addTime: (start, end, day) => enqueue({ type: 'time', start, end, day })
  };
  active = context(null);

  let banner;
  function announce() {
    if (!document.body) return;
    if (!banner) {
      banner = document.createElement('aside');
      banner.className = 'personal-sync-notice';
      banner.setAttribute('role', 'status');
      const text = document.createElement('span');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Réessayer';
      retry.addEventListener('click', () => { void sync(); });
      banner.append(text, retry);
      document.body.append(banner);
    }
    const state = view();
    const record = read(active);
    banner.hidden = !owner || (active.loaded && !['offline', 'blocked'].includes(state.syncStatus) &&
      state.persistent && !active.migrationError && !active.writeError && !active.intentError && !record.rejected.length &&
      !record.pending.some(operation => operation.type !== 'time'));
    const refused = record.rejected.length && (state.pending || active.writeError) ? ` ${refusalMessage(record)}` : '';
    banner.querySelector('span').textContent = (active.intentError || active.writeError || statusMessage()) + refused +
      (active.migrationError ? ' Certaines anciennes données n’ont pas été importées ; les originaux sont conservés.' : '');
    let retryRefused = banner.querySelector('[data-retry-rejected]');
    if (record.rejected.length && !retryRefused) {
      retryRefused = document.createElement('button');
      retryRefused.type = 'button';
      retryRefused.dataset.retryRejected = 'true';
      retryRefused.textContent = 'Réessayer les modifications refusées';
      retryRefused.addEventListener('click', () => { void retryRejected(); });
      banner.append(retryRefused);
    } else if (!record.rejected.length) retryRefused?.remove();
  }

  window.addEventListener('hessflix-personal-changed', announce);
  window.addEventListener('online', () => { void sync(); });
  window.addEventListener('storage', event => { if (event.key === active?.key) emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  setInterval(() => { if (!document.hidden) void sync(); }, 20000);
  queueMicrotask(connect);
  window.addEventListener('movix-auth-status', connect);
})();
