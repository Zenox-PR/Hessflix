// The private draft does not publish a second ranking. Public display always
// reads featured/rank from publicCatalogue, including edits made in the catalogue.
const { HttpError } = require('./policy.cjs');
const model = require('./catalogue-model.cjs');

const MAX_SLIDES = 12;
// Two writes per affected title plus one settings write must remain below 500.
const MAX_AFFECTED_ENTRIES = 249;
const validImage = value => typeof value === 'string' && value.length <= 2048 && (
  /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w500|w780|w1280)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value) ||
  /^assets\/discovery\/[a-z0-9-]+\.(?:jpg|png|webp)$/.test(value)
);
const HERO_FIELDS = [
  'id', 'catalogueId', 'title', 'kind', 'category', 'isAnime', 'year', 'rating',
  'overview', 'heroBackdrop', 'backdrop', 'image', 'poster', 'availability',
  'rank', 'featured', 'genres', 'tmdbId', 'mediaType'
];

function heroItem(item) {
  return model.clean(Object.fromEntries(HERO_FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]])));
}

function imageOptions(entry, extra = []) {
  return [...new Set([entry.editor.heroBackdrop, entry.meta.backdrop, ...extra].filter(validImage))].slice(0, 20);
}

function validateSlots(slots) {
  if (!Array.isArray(slots) || slots.length > MAX_SLIDES) throw new HttpError(400, 'HERO_INVALID_DRAFT');
  const seen = new Set();
  return slots.map(slot => {
    model.object(slot, ['id', 'image']);
    const id = model.id(slot.id);
    if (seen.has(id)) throw new HttpError(400, 'HERO_DUPLICATE');
    seen.add(id);
    if (typeof slot.image !== 'string' || (slot.image && !validImage(slot.image))) {
      throw new HttpError(400, 'HERO_INVALID_IMAGE');
    }
    return { id, image: slot.image };
  });
}

function createHeroStore({ getFirestore, catalogue, images = async () => [], now = () => new Date().toISOString() }) {
  const settingsRef = db => db.collection('catalogueSettings').doc('homepageHero');
  const entryRef = (db, id) => db.collection('catalogueEntries').doc(model.id(id));
  const featuredQuery = db => db.collection('publicCatalogue').where('featured', '==', true).limit(MAX_AFFECTED_ENTRIES + 1);
  const privateFeaturedQuery = db => db.collection('catalogueEntries').where('editor.featured', '==', true).limit(MAX_AFFECTED_ENTRIES + 1);

  function checkSize(count) {
    if (count > MAX_AFFECTED_ENTRIES) throw new HttpError(409, 'HERO_CONFIGURATION_TOO_LARGE');
  }

  async function publicItems() {
    const db = await getFirestore();
    const snapshot = await featuredQuery(db).get();
    checkSize(snapshot.docs.length);
    return snapshot.docs.map(doc => doc.data())
      .filter(item => item.status === 'published' && item.featured === true)
      .sort((left, right) => (left.rank || 0) - (right.rank || 0) || left.title.localeCompare(right.title, 'fr'))
      .slice(0, MAX_SLIDES).map(heroItem);
  }

  function previewItem(entry, image = '') {
    const item = heroItem(model.projection(entry));
    item.heroBackdrop = image || entry.meta.backdrop || '';
    return item;
  }

  async function read() {
    const db = await getFirestore();
    const [snapshot, published] = await Promise.all([settingsRef(db).get(), publicItems()]);
    const saved = snapshot.data();
    // Outside a pending draft, mirror the existing featured/rank controls rather
    // than resurrecting an old saved copy after a direct catalogue edit.
    const slots = saved?.pending ? validateSlots(saved.slots) :
      published.map(item => ({ id: item.catalogueId || item.id, image: item.heroBackdrop || item.backdrop || '' }));
    const entries = await Promise.all(slots.map(async slot => {
      try {
        const { entry } = await catalogue.get(slot.id);
        return { ...slot, item: previewItem(entry, slot.image), available: entry.status === 'published' };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
        return { ...slot, item: null, available: false };
      }
    }));
    return {
      version: saved?.version || 0,
      entries,
      published,
      pending: saved?.pending || false,
      publishedAt: saved?.publishedAt || ''
    };
  }

  async function galleryForEntry(entry) {
    let extra = [], warning = '';
    try {
      extra = await images(entry);
      if (!Array.isArray(extra)) throw new Error('Invalid image gallery');
    } catch {
      extra = [];
      warning = 'La galerie TMDB est indisponible. Le fond déjà connu reste utilisable.';
    }
    return { images: imageOptions(entry, extra), warning, fallback: validImage(entry.meta.image) ? entry.meta.image : '' };
  }

  async function gallery(id) {
    const { entry } = await catalogue.get(model.id(id));
    return galleryForEntry(entry);
  }

  async function save(version, slots, uid) {
    if (!Number.isSafeInteger(version) || version < 0) throw new HttpError(400, 'HERO_INVALID_DRAFT');
    const validated = validateSlots(slots);
    await Promise.all(validated.map(async slot => {
      const { entry } = await catalogue.get(slot.id);
      if (entry.status !== 'published') throw new HttpError(409, 'HERO_PUBLISHED_ONLY');
      if (slot.image) {
        const result = await galleryForEntry(entry);
        if (!result.images.includes(slot.image)) throw new HttpError(400, 'HERO_INVALID_IMAGE');
      }
    }));

    const db = await getFirestore();
    const ref = settingsRef(db);
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if ((current?.version || 0) !== version) throw new HttpError(409, 'HERO_CONFLICT');
      // Parent visibility may have changed while the gallery was loading.
      const entries = await Promise.all(validated.map(slot => tx.get(entryRef(db, slot.id))));
      if (entries.some(doc => doc.data()?.status !== 'published')) throw new HttpError(409, 'HERO_PUBLISHED_ONLY');
      tx.set(ref, {
        version: version + 1,
        slots: validated,
        pending: true,
        updatedAt: now(),
        updatedBy: uid,
        publishedAt: current?.publishedAt || ''
      });
    });
    return read();
  }

  async function publish(version, uid) {
    if (!Number.isSafeInteger(version) || version < 0) throw new HttpError(400, 'HERO_INVALID_DRAFT');
    const db = await getFirestore();
    const ref = settingsRef(db);
    await db.runTransaction(async tx => {
      const draft = (await tx.get(ref)).data();
      if (!draft || draft.version !== version) throw new HttpError(409, 'HERO_CONFLICT');
      const slots = validateSlots(draft.slots);
      const previousPublic = (await tx.get(featuredQuery(db))).docs;
      const previousPrivate = (await tx.get(privateFeaturedQuery(db))).docs;
      checkSize(previousPublic.length);
      checkSize(previousPrivate.length);
      // Include hidden/private featured entries too: otherwise publishing one of
      // them later could unexpectedly reintroduce an administrator-removed slide.
      const ids = [...new Set([...slots.map(slot => slot.id), ...previousPublic.map(doc => doc.id), ...previousPrivate.map(doc => doc.id)])];
      checkSize(ids.length);
      const snapshots = await Promise.all(ids.map(id => tx.get(entryRef(db, id))));
      const seasons = await Promise.all(ids.map(id => tx.get(entryRef(db, id).collection('seasons'))));
      const positions = new Map(slots.map((slot, index) => [slot.id, index]));

      for (let index = 0; index < ids.length; index++) {
        const entry = snapshots[index].data();
        if (positions.has(ids[index]) && entry?.status !== 'published') throw new HttpError(409, 'HERO_PUBLISHED_ONLY');
        if (entry?.lock) throw new HttpError(409, 'CATALOGUE_IMPORT_BUSY');
      }

      const time = now();
      for (let index = 0; index < ids.length; index++) {
        const entry = snapshots[index].data();
        const publicRef = db.collection('publicCatalogue').doc(ids[index]);
        // Remove an orphan projection without destroying any private catalogue data.
        if (!entry) {
          tx.delete(publicRef);
          continue;
        }
        const position = positions.get(entry.id);
        const next = {
          ...entry,
          editor: { ...entry.editor, featured: position !== undefined },
          version: entry.version + 1,
          updatedAt: time,
          updatedBy: uid
        };
        if (position !== undefined) Object.assign(next.editor, { rank: position + 1, heroBackdrop: slots[position].image });
        tx.set(entryRef(db, entry.id), model.clean(next));
        if (next.status === 'published') tx.set(publicRef, model.projection(next, seasons[index].docs.map(doc => doc.data())));
        else tx.delete(publicRef);
      }
      tx.set(ref, { ...draft, version: version + 1, pending: false, publishedAt: time, publishedBy: uid });
    });
    return read();
  }

  return { read, save, publish, publicItems, gallery, max: MAX_SLIDES };
}

module.exports = { createHeroStore, validImage, imageOptions, MAX_SLIDES, MAX_AFFECTED_ENTRIES };
