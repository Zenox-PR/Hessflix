// Modèle partagé : opérations par champ, jamais remplacement par un ancien instantané.
(() => {
  const LIMITS = { titles: 500, history: 1000, days: 366, windows: 4096, touched: 5000, migrations: 256, devices: 128 };
  const rejectionReasons = new Set([
    'PERSONAL_FAVORITES_LIMIT', 'PERSONAL_WATCHLIST_LIMIT', 'PERSONAL_HISTORY_LIMIT',
    'PERSONAL_PROGRESS_LIMIT', 'PERSONAL_SELECTION_LIMIT', 'PERSONAL_METADATA_LIMIT'
  ]);

  const validId = id => typeof id === 'string' && id.length <= 64 &&
    /^(movie-tt\d+|series-\d+|jw-(tm|ts)\d+|tmdb-(movie|tv)-[1-9]\d{0,8})$/.test(id);
  const validChoice = value => value === undefined || (value &&
    Object.keys(value).every(name => ['season', 'episode'].includes(name)) &&
    Number.isInteger(value.season) && value.season >= 0 && value.season < 10000 &&
    Number.isInteger(value.episode) && value.episode > 0 && value.episode < 100000);
  const key = item => item.id + ':' + (item.choice ? item.choice.season + ':' + item.choice.episode : 'title');
  const empty = () => ({
    version: 1, revision: 0, favorites: [], watchlist: [], progress: [], history: [],
    seconds: 0, days: {}, lastEnd: 0, windows: [], touched: {}, migrations: {}, cursors: {}
  });

  function check(condition, code = 'INVALID_PERSONAL_OPERATION') {
    if (!condition) throw Object.assign(new Error(code), { code });
  }

  function isTerminalRejection(error) {
    return rejectionReasons.has(typeof error === 'string' ? error : error?.code);
  }

  function rejectionMessage(reason) {
    const messages = {
      PERSONAL_FAVORITES_LIMIT: 'La limite de 500 favoris est atteinte.',
      PERSONAL_WATCHLIST_LIMIT: 'La limite de 500 titres À voir est atteinte.',
      PERSONAL_HISTORY_LIMIT: 'La limite de 1 000 entrées d’historique est atteinte.',
      PERSONAL_PROGRESS_LIMIT: 'La limite de 500 titres suivis est atteinte.',
      PERSONAL_SELECTION_LIMIT: 'La limite de 500 sélections d’épisodes est atteinte.',
      PERSONAL_METADATA_LIMIT: 'La limite de stockage des préférences est atteinte.'
    };
    return messages[reason] || 'Cette modification a été refusée par le serveur.';
  }

  function validateImport(data) {
    check(data && Object.keys(data).every(name =>
      ['favorites', 'watchlist', 'progress', 'history', 'seconds', 'days', 'selections'].includes(name)));
    for (const name of ['favorites', 'watchlist']) {
      check(Array.isArray(data[name]) && data[name].length <= LIMITS.titles && data[name].every(validId));
    }
    check(Array.isArray(data.progress) && data.progress.length <= LIMITS.titles &&
      Array.isArray(data.history) && data.history.length <= LIMITS.history);
    for (const item of [...data.progress, ...data.history]) {
      check(item && validId(item.id) && validChoice(item.choice) && Number.isFinite(item.at) && item.at >= 0);
    }
    check(data.progress.every(item => ['in-progress', 'completed'].includes(item.status)));
    check(Number.isFinite(data.seconds) && data.seconds >= 0 && data.seconds <= 1e10 &&
      data.days && typeof data.days === 'object' && !Array.isArray(data.days) &&
      Object.keys(data.days).length <= LIMITS.days);
    for (const [day, seconds] of Object.entries(data.days)) {
      check(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400);
    }
    if (data.selections) {
      check(Array.isArray(data.selections) && data.selections.length <= LIMITS.titles &&
        data.selections.every(item => validId(item.id) && item.choice && validChoice(item.choice)));
    }
  }

  function validate(operation) {
    check(operation && typeof operation === 'object' && !Array.isArray(operation));
    const fields = {
      skip: [], favorite: ['id', 'value'], watchlist: ['id', 'value'],
      status: ['id', 'status', 'choice', 'episodeCount', 'at'], removeProgress: ['id'],
      removeHistory: ['id', 'choice'], selection: ['id', 'choice', 'at'],
      time: ['start', 'end', 'day'], import: ['source', 'data']
    };
    check(Object.hasOwn(fields, operation.type) && Object.keys(operation).every(name =>
      ['type', 'seq', ...fields[operation.type]].includes(name)));
    if (['favorite', 'watchlist', 'status', 'removeProgress', 'removeHistory', 'selection'].includes(operation.type)) {
      check(validId(operation.id));
    }
    if (['favorite', 'watchlist'].includes(operation.type)) check(typeof operation.value === 'boolean');
    if (operation.type === 'status') {
      check(['in-progress', 'completed'].includes(operation.status));
      check(operation.episodeCount === undefined ||
        (Number.isSafeInteger(operation.episodeCount) && operation.episodeCount >= 0 && operation.episodeCount < 100000));
    }
    if ('choice' in operation) check(validChoice(operation.choice));
    if (operation.type === 'selection') check(operation.choice !== undefined);
    if ('at' in operation) check(Number.isFinite(operation.at) && operation.at >= 0 && operation.at < 1e14);
    if (operation.type === 'time') {
      check(Number.isFinite(operation.start) && Number.isFinite(operation.end) &&
        operation.start >= 0 && operation.end > operation.start && operation.end - operation.start <= 300000 &&
        /^\d{4}-\d{2}-\d{2}$/.test(operation.day));
    }
    if (operation.type === 'import') {
      check(typeof operation.source === 'string' && /^[a-f0-9]{64}$/.test(operation.source));
      validateImport(operation.data);
    }
    return operation;
  }

  function applyList(state, operation) {
    const list = operation.type === 'favorite' ? 'favorites' : 'watchlist';
    if (operation.value) {
      check(state[list].includes(operation.id) || state[list].length < LIMITS.titles,
        list === 'favorites' ? 'PERSONAL_FAVORITES_LIMIT' : 'PERSONAL_WATCHLIST_LIMIT');
      if (!state[list].includes(operation.id)) state[list].unshift(operation.id);
    } else {
      state[list] = state[list].filter(id => id !== operation.id);
    }
    state.touched[operation.type + ':' + operation.id] = true;
  }

  function applyStatus(state, operation) {
    const entry = { id: operation.id, at: operation.at ?? Date.now(), ...(operation.choice ? { choice: { ...operation.choice } } : {}) };
    if (operation.status === 'completed' && !state.history.some(item => key(item) === key(entry))) {
      check(state.history.length < LIMITS.history, 'PERSONAL_HISTORY_LIMIT');
      state.history.unshift(entry);
      state.touched['history:' + key(entry)] = true;
    }
    const complete = operation.status === 'completed' && (!operation.choice ||
      (operation.episodeCount > 0 && state.history.filter(item => item.id === operation.id && item.choice).length >= operation.episodeCount));
    state.progress = [{ ...entry, status: complete ? 'completed' : 'in-progress' },
      ...state.progress.filter(item => item.id !== operation.id)];
    check(state.progress.length <= LIMITS.titles, 'PERSONAL_PROGRESS_LIMIT');
    state.touched['progress:' + operation.id] = true;
  }

  function applyTime(state, operation) {
    let overlap = 0;
    for (const { start, end } of state.windows) {
      overlap += Math.max(0, Math.min(end, operation.end) - Math.max(start, operation.start));
    }
    const seconds = Math.max(0, (operation.end - operation.start - overlap) / 1000);
    state.seconds += seconds;
    state.days[operation.day] = Math.min(86400, (state.days[operation.day] || 0) + seconds);
    const windows = [...state.windows, { start: operation.start, end: operation.end }].sort((a, b) => a.start - b.start);
    const merged = [];
    for (const span of windows) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    state.windows = merged.slice(-LIMITS.windows);
    state.lastEnd = Math.max(state.lastEnd || 0, operation.end);
  }

  function applyImport(state, operation) {
    if (state.migrations[operation.source]) return;
    const data = operation.data;
    for (const name of ['favorites', 'watchlist']) {
      for (const id of data[name]) {
        const touchedKey = (name === 'favorites' ? 'favorite:' : 'watchlist:') + id;
        if (!state.touched[touchedKey] && !state[name].includes(id)) {
          check(state[name].length < LIMITS.titles,
            name === 'favorites' ? 'PERSONAL_FAVORITES_LIMIT' : 'PERSONAL_WATCHLIST_LIMIT');
          state[name].push(id);
        }
      }
    }
    for (const entry of data.progress) {
      if (!state.touched['progress:' + entry.id] && !state.progress.some(item => item.id === entry.id)) {
        check(state.progress.length < LIMITS.titles, 'PERSONAL_PROGRESS_LIMIT');
        state.progress.push({ id: entry.id, status: entry.status, at: entry.at, ...(entry.choice ? { choice: entry.choice } : {}) });
      }
    }
    for (const entry of data.history) {
      if (!state.touched['history:' + key(entry)] && !state.history.some(item => key(item) === key(entry))) {
        check(state.history.length < LIMITS.history, 'PERSONAL_HISTORY_LIMIT');
        state.history.push({ id: entry.id, at: entry.at, ...(entry.choice ? { choice: entry.choice } : {}) });
      }
    }
    for (const entry of data.selections || []) {
      if (!state.touched['selection:' + entry.id] && !state.selections[entry.id]) state.selections[entry.id] = entry.choice;
    }
    for (const [day, seconds] of Object.entries(data.days)) {
      state.seconds += Math.max(0, seconds - (state.days[day] || 0));
      state.days[day] = Math.max(seconds, state.days[day] || 0);
    }
    state.seconds = Math.max(state.seconds, data.seconds);
    state.migrations[operation.source] = true;
  }

  function applyMutable(state, operation) {
    validate(operation);
    state.touched ||= {};
    state.migrations ||= {};
    state.windows ||= [];
    state.selections ||= {};
    switch (operation.type) {
      case 'favorite':
      case 'watchlist': applyList(state, operation); break;
      case 'status': applyStatus(state, operation); break;
      case 'removeProgress':
        state.progress = state.progress.filter(item => item.id !== operation.id);
        state.touched['progress:' + operation.id] = true;
        break;
      case 'removeHistory': {
        state.history = state.history.filter(item => key(item) !== key(operation));
        const record = state.progress.find(item => item.id === operation.id);
        if (record) record.status = 'in-progress';
        state.touched['history:' + key(operation)] = true;
        break;
      }
      case 'selection':
        state.selections[operation.id] = { ...operation.choice };
        state.touched['selection:' + operation.id] = true;
        break;
      case 'time': applyTime(state, operation); break;
      case 'import': applyImport(state, operation); break;
      case 'skip': break;
    }
    check(Object.keys(state.touched).length <= LIMITS.touched && Object.keys(state.migrations).length <= LIMITS.migrations,
      'PERSONAL_METADATA_LIMIT');
    check(Object.keys(state.selections).length <= LIMITS.titles, 'PERSONAL_SELECTION_LIMIT');
    const days = Object.keys(state.days).sort();
    for (const day of days.slice(0, Math.max(0, days.length - LIMITS.days))) delete state.days[day];
    state.progress.sort((a, b) => b.at - a.at);
    state.history.sort((a, b) => b.at - a.at);
  }

  function apply(state, operation) {
    // A refusal must not leave half an import/history update in an optimistic projection.
    const candidate = structuredClone(state);
    applyMutable(candidate, operation);
    Object.assign(state, candidate);
    return state;
  }

  function validState(state) {
    try {
      check(state && state.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0);
      validateImport({
        favorites: state.favorites, watchlist: state.watchlist, progress: state.progress,
        history: state.history, seconds: state.seconds, days: state.days
      });
      check(Number.isFinite(state.lastEnd) && state.lastEnd >= 0 && Array.isArray(state.windows) && state.windows.length <= LIMITS.windows);
      let end = 0;
      for (const span of state.windows) {
        check(span && Number.isFinite(span.start) && Number.isFinite(span.end) && span.start >= end && span.end > span.start);
        end = span.end;
      }
      for (const [name, limit] of [['touched', LIMITS.touched], ['migrations', LIMITS.migrations], ['cursors', LIMITS.devices], ['selections', LIMITS.titles]]) {
        const values = state[name] || (name === 'selections' ? {} : null);
        check(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length <= limit);
      }
      check(Object.values(state.touched).every(value => value === true));
      check(Object.entries(state.migrations).every(([name, value]) => /^[a-f0-9]{64}$/.test(name) && value === true));
      check(Object.entries(state.cursors).every(([device, value]) => /^[a-f0-9-]{36}$/.test(device) && Number.isSafeInteger(value) && value >= 0));
      check(Object.entries(state.selections || {}).every(([id, value]) => validId(id) && value && validChoice(value)));
      return true;
    } catch {
      return false;
    }
  }

  const api = { empty, validate, apply, validId, key, validState, isTerminalRejection, rejectionMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.HessflixPersonalModel = api;
})();
