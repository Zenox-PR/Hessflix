const { randomUUID } = require('node:crypto');
const { HttpError, ADMIN_UID } = require('./policy.cjs');
const model = require('./catalogue-model.cjs');
const { videoSource, publicVideo } = require('./vidmoly.cjs');

const ROOT = 'catalogueEntries';
const PUBLIC = 'publicCatalogue';
const IMPORT_BATCH_SIZE = 150;

function mergeMetadata(previous, incoming) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== '' && value !== null && value !== undefined) merged[key] = value;
  }
  return merged;
}

function checkEpisodeIdentities(existing, incoming) {
  const byNumber = new Map(incoming.map(episode => [episode.number, episode]));
  const byIdentity = new Map(incoming.filter(episode => episode.tmdbId).map(episode => [episode.tmdbId, episode]));
  for (const episode of existing) {
    const replacement = byNumber.get(episode.number);
    const moved = episode.meta.tmdbId && byIdentity.get(episode.meta.tmdbId);
    if ((replacement && episode.meta.tmdbId && replacement.tmdbId && episode.meta.tmdbId !== replacement.tmdbId) ||
        (moved && moved.number !== episode.number)) {
      throw new HttpError(409, 'CATALOGUE_NUMBERING_CHANGED');
    }
  }
}

function createCatalogueStore({ getFirestore, now = () => new Date().toISOString() }) {
  const entryRef = (db, id) => db.collection(ROOT).doc(model.id(id));
  const publicRef = (db, id) => db.collection(PUBLIC).doc(id);
  const locked = entry => entry.lock && Date.now() - entry.lock.startedAt < 600000;

  function check(entry, version) {
    if (!entry) throw new HttpError(404, 'CATALOGUE_NOT_FOUND');
    if (entry.version !== version) throw new HttpError(409, 'CATALOGUE_CONFLICT');
    if (locked(entry)) throw new HttpError(409, 'CATALOGUE_IMPORT_BUSY');
    if (entry.status === 'purging') throw new HttpError(409, 'CATALOGUE_PURGING');
  }

  function write(tx, db, entry, seasons) {
    tx.set(entryRef(db, entry.id), model.clean(entry));
    if (entry.status === 'published') tx.set(publicRef(db, entry.id), model.projection(entry, seasons));
    else tx.delete(publicRef(db, entry.id));
  }

  async function create(item, category, uid, extra = {}) {
    if (extra.importJobId !== undefined && (uid !== ADMIN_UID || !/^popular-\d{8}-[a-f0-9]{12}$/.test(extra.importJobId))) throw new HttpError(403, 'CATALOGUE_IMPORT_JOB_REJECTED');
    const db = await getFirestore();
    const id = model.canonical(item.mediaType, item.tmdbId);
    const ref = entryRef(db, id);
    const time = now();
    const entry = {
      id,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      status: 'draft',
      version: 1,
      meta: model.clean(item),
      editor: {
        category,
        title: '',
        overview: '',
        collection: extra.collection || '',
        rank: 0,
        featured: false,
        ...(extra.platforms !== undefined ? { platforms: model.platforms(extra.platforms) } : {})
      },
      aliases: extra.aliases || [],
      createdAt: time,
      updatedAt: time,
      syncedAt: time,
      createdBy: uid,
      updatedBy: uid
    };
    if (extra.importJobId) entry.importJobId = extra.importJobId;
    await db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) throw new HttpError(409, 'CATALOGUE_DUPLICATE');
      tx.create(ref, entry);
    });
    return entry;
  }

  async function get(id) {
    const db = await getFirestore();
    const ref = entryRef(db, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpError(404, 'CATALOGUE_NOT_FOUND');
    const seasons = await ref.collection('seasons').get();
    return {
      entry: snapshot.data(),
      seasons: seasons.docs.map(doc => doc.data()).sort((left, right) => left.number - right.number)
    };
  }

  async function list({ status = '', query = '', after = '', limit = 30 } = {}) {
    const db = await getFirestore();
    let request = db.collection(ROOT).orderBy('updatedAt', 'desc');
    // Private filters apply to a bounded document page; the cursor still advances.
    if (after) {
      const snapshot = await entryRef(db, after).get();
      if (!snapshot.exists) throw new HttpError(400, 'CATALOGUE_INVALID_CURSOR');
      request = request.startAfter(snapshot);
    }
    const result = await request.limit(limit + 1).get();
    const docs = result.docs.slice(0, limit);
    const entries = docs.map(doc => doc.data()).filter(entry =>
      (!status || entry.status === status) &&
      (!query || model.normalise(entry.editor.title || entry.meta.title).includes(model.normalise(query)))
    );
    return { entries, nextCursor: result.docs.length > limit ? docs[docs.length - 1].id : null };
  }

  async function edit(id, version, uid, change) {
    const db = await getFirestore();
    const ref = entryRef(db, id);
    await db.runTransaction(async tx => {
      const entry = (await tx.get(ref)).data();
      check(entry, version);
      const seasons = (await tx.get(ref.collection('seasons'))).docs.map(doc => doc.data());
      const result = await change(entry, seasons, tx, ref);
      const next = result.entry || entry;
      next.version = entry.version + 1;
      next.updatedAt = now();
      next.updatedBy = uid;
      if (next.status === 'published' && !next.publishedAt) next.publishedAt = now();
      for (const action of result.writes || []) action(tx);
      write(tx, db, next, result.seasons || seasons);
    });
    return get(id);
  }

  async function patch(id, version, uid, payload) {
    return edit(id, version, uid, entry => {
      if (entry.status === 'deleted') throw new HttpError(409, 'CATALOGUE_RESTORE_REQUIRED');
      return {
        entry: {
          ...entry,
          editor: payload.editor ? model.editor(payload.editor, entry.mediaType, entry.editor) : entry.editor,
          status: payload.status || entry.status
        }
      };
    });
  }

  async function refresh(id, version, uid, metadata) {
    return edit(id, version, uid, entry => {
      if (entry.status === 'deleted') throw new HttpError(409, 'CATALOGUE_RESTORE_REQUIRED');
      const meta = { ...entry.meta };
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== '' && value !== null && value !== undefined && (!Array.isArray(value) || value.length)) {
          meta[key] = value;
        }
      }
      return { entry: { ...entry, meta, syncedAt: now() } };
    });
  }

  async function state(id, version, uid, status) {
    return edit(id, version, uid, entry => ({ entry: { ...entry, status } }));
  }

  async function season(id, number) {
    const db = await getFirestore();
    const ref = entryRef(db, id).collection('seasons').doc(String(number));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpError(404, 'CATALOGUE_SEASON_NOT_FOUND');
    const episodes = await ref.collection('episodes').orderBy('number').get();
    return { season: snapshot.data(), episodes: episodes.docs.map(doc => doc.data()) };
  }

  async function importSeason(id, version, uid, number, guide, approval = {}) {
    const db = await getFirestore();
    const ref = entryRef(db, id);
    const seasonRef = ref.collection('seasons').doc(String(number));
    const nonce = randomUUID();
    let missingNumbers = [];
    const approveAired = approval.publishAiredThrough !== undefined;
    if (approveAired && (uid !== ADMIN_UID || !/^\d{4}-\d{2}-\d{2}$/.test(approval.publishAiredThrough) ||
        !Number.isFinite(Date.parse(approval.publishAiredThrough)) || approval.publishAiredThrough > now().slice(0, 10) ||
        !/^popular-\d{8}-[a-f0-9]{12}$/.test(approval.importJobId || ''))) throw new HttpError(403, 'CATALOGUE_IMPORT_JOB_REJECTED');

    await db.runTransaction(async tx => {
      const entry = (await tx.get(ref)).data();
      check(entry, version);
      if (entry.mediaType !== 'tv' || entry.status === 'deleted') throw new HttpError(400, 'CATALOGUE_NOT_SERIES');
      if (approveAired && (entry.importJobId !== approval.importJobId || entry.status !== 'draft')) throw new HttpError(403, 'CATALOGUE_IMPORT_JOB_REJECTED');
      const previous = (await tx.get(seasonRef)).data();
      const descriptor = entry.meta.tmdbSeasons?.find(value => value.number === number);
      if (!descriptor) throw new HttpError(400, 'CATALOGUE_INVALID_SEASON');
      const existing = (await tx.get(seasonRef.collection('episodes'))).docs.map(doc => doc.data());

      // Editorial approval must never move from one TMDB episode identity to another.
      checkEpisodeIdentities(existing, guide.episodes);
      const incomingNumbers = new Set(guide.episodes.map(episode => episode.number));
      missingNumbers = existing.filter(episode => !incomingNumbers.has(episode.number)).map(episode => episode.number);
      const metadata = mergeMetadata(previous, descriptor);
      tx.set(ref, { ...entry, lock: { nonce, startedAt: Date.now() }, version: entry.version + 1, updatedAt: now() });
      tx.set(seasonRef, {
        ...metadata,
        number,
        published: previous?.published || false,
        publishedEpisodes: previous?.publishedEpisodes || 0,
        complete: previous?.complete || false,
        importing: true,
        importError: false
      });
    });

    try {
      // Retire missing drafts first so a later failed metadata batch cannot leave
      // them publishable. Existing publications and manual corrections stay intact.
      await retireMissingEpisodes();
      for (let start = 0; start < guide.episodes.length; start += IMPORT_BATCH_SIZE) {
        await importBatch(guide.episodes.slice(start, start + IMPORT_BATCH_SIZE));
      }
      await finish(true);
    } catch (error) {
      await finish(false).catch(() => {});
      throw error;
    }
    return get(id);

    async function requireImportLock(tx) {
      const entry = (await tx.get(ref)).data();
      if (entry?.lock?.nonce !== nonce) throw new HttpError(409, 'CATALOGUE_IMPORT_CANCELLED');
      return entry;
    }

    async function importBatch(episodes) {
      await db.runTransaction(async tx => {
        await requireImportLock(tx);
        const refs = episodes.map(episode => seasonRef.collection('episodes').doc(String(episode.number)));
        const previous = await Promise.all(refs.map(reference => tx.get(reference)));
        episodes.forEach((episode, index) => {
          const old = previous[index].data();
          // An unknown identity must not revive a stale, possibly corrected record.
          if (old?.obsolete && (!old.meta.tmdbId || old.meta.tmdbId !== episode.tmdbId)) return;
          const next = {
            ...old,
            number: episode.number,
            meta: model.clean(mergeMetadata(old?.meta, episode)),
            // Bulk approval is reserved for new, job-owned drafts. Existing
            // episode choices are never changed, including an explicit false.
            published: old?.published ?? Boolean(approveAired && /^\d{4}-\d{2}-\d{2}$/.test(episode.airdate || '') && episode.airdate <= approval.publishAiredThrough),
            editor: old?.editor || { title: '', overview: '' },
            obsolete: false,
            updatedAt: now()
          };
          delete next.obsoleteAt;
          delete next.obsoleteReason;
          tx.set(refs[index], next);
        });
      });
    }

    async function retireMissingEpisodes() {
      for (let start = 0; start < missingNumbers.length; start += IMPORT_BATCH_SIZE) {
        const numbers = missingNumbers.slice(start, start + IMPORT_BATCH_SIZE);
        await db.runTransaction(async tx => {
          await requireImportLock(tx);
          const refs = numbers.map(value => seasonRef.collection('episodes').doc(String(value)));
          const previous = await Promise.all(refs.map(reference => tx.get(reference)));
          previous.forEach((snapshot, index) => {
            const old = snapshot.data();
            if (!old) return;
            tx.set(refs[index], {
              ...old,
              obsolete: true,
              obsoleteReason: 'missing-from-tmdb',
              obsoleteAt: old.obsoleteAt || now(),
              updatedAt: now()
            });
          });
        });
      }
    }

    async function finish(complete) {
      await db.runTransaction(async tx => {
        const entry = await requireImportLock(tx);
        const seasons = (await tx.get(ref.collection('seasons'))).docs.map(doc => doc.data());
        const airedCount = approveAired ? (await tx.get(seasonRef.collection('episodes'))).docs.filter(doc => doc.data().published).length : 0;
        const updated = seasons.map(value => value.number === number ? {
          ...value,
          complete: complete || value.complete,
          importing: false,
          importError: !complete,
          ...(approveAired && complete ? { published: airedCount > 0, publishedEpisodes: airedCount } : {})
        } : value);
        const next = { ...entry, version: entry.version + 1, updatedAt: now(), updatedBy: uid };
        delete next.lock;
        tx.set(seasonRef, updated.find(value => value.number === number));
        write(tx, db, next, updated);
      });
    }
  }

  async function patchSeason(id, version, uid, number, payload) {
    return edit(id, version, uid, async (entry, seasons, tx, ref) => {
      if (entry.status === 'deleted') throw new HttpError(409, 'CATALOGUE_RESTORE_REQUIRED');
      const current = seasons.find(value => value.number === number);
      if (!current) throw new HttpError(404, 'CATALOGUE_SEASON_NOT_FOUND');
      if (!current.complete && payload.published) throw new HttpError(409, 'CATALOGUE_IMPORT_INCOMPLETE');
      const next = { ...current, ...payload };
      return {
        entry,
        seasons: seasons.map(value => value.number === number ? next : value),
        writes: [transaction => transaction.set(ref.collection('seasons').doc(String(number)), next)]
      };
    });
  }

  async function patchEpisode(id, version, uid, number, episodeNumber, payload) {
    return edit(id, version, uid, async (entry, seasons, tx, ref) => {
      if (entry.status === 'deleted') throw new HttpError(409, 'CATALOGUE_RESTORE_REQUIRED');
      const current = seasons.find(value => value.number === number);
      if (!current) throw new HttpError(404, 'CATALOGUE_SEASON_NOT_FOUND');
      if (!current.complete) throw new HttpError(409, 'CATALOGUE_IMPORT_INCOMPLETE');
      const seasonRef = ref.collection('seasons').doc(String(number));
      const episodeRef = seasonRef.collection('episodes').doc(String(episodeNumber));
      const episode = (await tx.get(episodeRef)).data();
      if (!episode) throw new HttpError(404, 'CATALOGUE_EPISODE_NOT_FOUND');
      if (episode.obsolete && payload.published === true && !episode.published) {
        throw new HttpError(409, 'CATALOGUE_EPISODE_OBSOLETE');
      }
      if ((current.importError || current.importing) && payload.published === true && !episode.published) {
        throw new HttpError(409, 'CATALOGUE_IMPORT_INCOMPLETE');
      }
      const next = {
        ...episode,
        ...payload,
        editor: { ...episode.editor, ...payload.editor },
        updatedAt: now()
      };
      const updatedSeason = {
        ...current,
        publishedEpisodes: (current.publishedEpisodes || 0) + (Number(next.published) - Number(episode.published))
      };
      return {
        entry,
        seasons: seasons.map(value => value.number === number ? updatedSeason : value),
        writes: [transaction => transaction.set(episodeRef, next), transaction => transaction.set(seasonRef, updatedSeason)]
      };
    });
  }

  async function changeVideo(id, version, uid, target, action, payload = {}) {
    return edit(id, version, uid, async (entry, seasons, tx, ref) => {
      if (entry.status === 'deleted') throw new HttpError(409, 'CATALOGUE_RESTORE_REQUIRED');
      const episodic = target !== null;
      if ((entry.mediaType === 'tv') !== episodic) throw new HttpError(400, 'VIDEO_WRONG_TARGET');
      let document = entry, episodeRef;
      if (episodic) {
        const season = seasons.find(value => value.number === target.season);
        if (!season?.complete || season.importing || season.importError) throw new HttpError(409, 'CATALOGUE_IMPORT_INCOMPLETE');
        episodeRef = ref.collection('seasons').doc(String(target.season)).collection('episodes').doc(String(target.episode));
        document = (await tx.get(episodeRef)).data();
        if (!document) throw new HttpError(404, 'CATALOGUE_EPISODE_NOT_FOUND');
      }
      let video;
      if (action === 'save') {
        video = { ...document.video, draft: videoSource(payload.url, payload.rightsConfirmed) };
      } else if (action === 'publish') {
        if (document.obsolete) throw new HttpError(409, 'CATALOGUE_EPISODE_OBSOLETE');
        if (!document.video?.draft) throw new HttpError(409, 'VIDEO_DRAFT_REQUIRED');
        video = { ...document.video, approved: videoSource(document.video.draft.embedURL, document.video.draft.rightsConfirmed) };
      } else if (action === 'remove') video = { draft: null, approved: null };
      else throw new HttpError(400, 'VIDEO_INVALID_ACTION');
      video.updatedAt = now(); video.updatedBy = uid;
      if (!episodic) return { entry: { ...entry, video } };
      return { entry, writes: [transaction => transaction.set(episodeRef, { ...document, video, updatedAt: now() })] };
    });
  }

  async function playback(value, target = null) {
    const item = await publicGet(value);
    const db = await getFirestore();
    const ref = entryRef(db, item.catalogueId || item.id);
    // Parent, season and episode are checked together, not from browser caches.
    return db.runTransaction(async tx => {
      const entry = (await tx.get(ref)).data();
      if (entry?.status !== 'published') throw new HttpError(404, 'CATALOGUE_NOT_PUBLISHED');
      if (entry.mediaType === 'movie') {
        if (target) throw new HttpError(400, 'VIDEO_WRONG_TARGET');
        return publicVideo(entry.video);
      }
      if (!target) throw new HttpError(400, 'VIDEO_EPISODE_REQUIRED');
      const seasonRef = ref.collection('seasons').doc(String(target.season));
      const season = (await tx.get(seasonRef)).data();
      const episode = (await tx.get(seasonRef.collection('episodes').doc(String(target.episode)))).data();
      if (!season?.published || !season.complete || !episode?.published) throw new HttpError(404, 'CATALOGUE_NOT_PUBLISHED');
      return publicVideo(episode.video);
    });
  }

  async function publicPage({ query = '', kind = 'Tous', provider = '', after = '', limit = 100 } = {}) {
    const db = await getFirestore();
    let request = db.collection(PUBLIC).where('status', '==', 'published');
    // Bounded metadata scan: exact array-prefix indexes disagree with the UI's
    // substring search (one letter, punctuation, middle words). A single known
    // published/updatedAt index also avoids a combinatorial set of cloud indexes.
    request = request.orderBy('updatedAt', 'desc');
    if (after) {
      const snapshot = await publicRef(db, model.id(after)).get();
      if (!snapshot.exists) throw new HttpError(409, 'CATALOGUE_REFRESH_REQUIRED');
      request = request.startAfter(snapshot);
    }
    const result = await request.limit(201).get();
    const needle = model.normalise(query);
    const items = [];
    let last = null, scanned = 0;
    for (const doc of result.docs.slice(0, 200)) {
      scanned++; last = doc;
      const item = model.publicItem(doc.data());
      const categoryMatches = kind === 'Tous' || item.kind === kind || (kind === 'Anime' && item.isAnime === true) || (['Animation', 'Documentaire'].includes(kind) && item.genres?.includes(kind));
      const haystack = model.normalise([item.title, item.originalTitle, ...(item.alternativeTitles || []), item.kind, ...(item.genres || [])].filter(Boolean).join(' '));
      if (categoryMatches && (!provider || model.platformsFor(item, item.platforms).includes(provider)) && (!needle || haystack.includes(needle))) items.push(item);
      if (items.length === limit) break;
    }
    return {
      items,
      nextCursor: last && result.docs.length > scanned ? last.id : null
    };
  }

  async function publicGet(value) {
    const db = await getFirestore();
    let snapshot;
    if (/^tmdb-(movie|tv)-[1-9]\d{0,8}$/.test(value)) snapshot = await publicRef(db, value).get();
    else {
      const result = await db.collection(PUBLIC).where('aliases', 'array-contains', value).where('status', '==', 'published').limit(1).get();
      snapshot = result.docs[0];
    }
    if (!snapshot?.exists || snapshot.data().status !== 'published') throw new HttpError(404, 'CATALOGUE_NOT_PUBLISHED');
    return model.publicItem(snapshot.data());
  }

  async function publicSeason(value, number) {
    const item = await publicGet(value);
    const guide = await season(item.catalogueId || item.id, number);
    // Recheck the parent: hiding a title during this read must not reopen access.
    const latest = await publicGet(item.id);
    if (!latest.tmdbSeasons?.some(value => value.number === number) || !guide.season.published || !guide.season.complete) {
      throw new HttpError(404, 'CATALOGUE_NOT_PUBLISHED');
    }
    return {
      episodes: guide.episodes.filter(episode => episode.published).map(episode => ({
        ...episode.meta,
        title: episode.editor.title || episode.meta.title,
        overview: episode.editor.overview || episode.meta.overview
      })),
      stale: false
    };
  }

  async function purge(id, version, uid) {
    const current = await get(id);
    if (current.entry.status === 'purging') {
      if (current.entry.version !== version) throw new HttpError(409, 'CATALOGUE_CONFLICT');
      const db = await getFirestore();
      await db.recursiveDelete(entryRef(db, id));
      return { ok: true };
    }
    const result = await edit(id, version, uid, entry => {
      if (entry.status !== 'deleted') throw new HttpError(409, 'CATALOGUE_TRASH_FIRST');
      return { entry: { ...entry, status: 'purging' } };
    });
    const db = await getFirestore();
    await db.recursiveDelete(entryRef(db, result.entry.id));
    return { ok: true };
  }

  async function recover(id, version, uid) {
    const db = await getFirestore();
    const ref = entryRef(db, id);
    await db.runTransaction(async tx => {
      const entry = (await tx.get(ref)).data();
      if (!entry || entry.version !== version) throw new HttpError(409, 'CATALOGUE_CONFLICT');
      const next = { ...entry, version: entry.version + 1, updatedAt: now(), updatedBy: uid };
      delete next.lock;
      tx.set(ref, next);
    });
    return get(id);
  }

  async function health() {
    const db = await getFirestore();
    await db.collection(ROOT).limit(1).get();
    return true;
  }

  return {
    create, get, list, patch, refresh, state, season, importSeason, patchSeason,
    patchEpisode, publicPage, publicGet, publicSeason, purge, recover, health,
    database: getFirestore, changeVideo, playback
  };
}

module.exports = { createCatalogueStore };
