const { randomUUID } = require('node:crypto');
const { HttpError } = require('./policy.cjs');
const { createProfileRepository, validate, validId, MAX_PROFILES } = require('./viewer-profiles.cjs');
const model = require('../personal-model.js');

function createCloudProfiles({ getFirestore, legacyDirectory }) {
  const legacy = createProfileRepository(legacyDirectory);
  const reference = (db, uid) => db.collection('viewerAccounts').doc(encodeURIComponent(uid));

  async function read(uid) {
    const db = await getFirestore();
    const ref = reference(db, uid);
    const snapshot = await ref.get();
    if (snapshot.exists) return snapshot.data().profiles;
    const previous = await legacy.read(uid);
    return db.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (current.exists) return current.data().profiles;
      transaction.set(ref, { version: 1, profiles: previous, legacyImportedAt: new Date().toISOString() });
      return previous;
    });
  }

  async function mutate(uid, work) {
    await read(uid);
    const db = await getFirestore();
    const ref = reference(db, uid);
    return db.runTransaction(async transaction => {
      const document = (await transaction.get(ref)).data();
      const profiles = document.profiles;
      work(profiles);
      transaction.set(ref, { ...document, profiles });
      return profiles;
    });
  }

  return {
    read,
    cloud: true,
    create(uid, data) {
      const profile = { id: randomUUID(), photoURL: '', ...validate(data) };
      return mutate(uid, profiles => {
        if (profiles.length >= MAX_PROFILES - 1) throw new HttpError(409, 'PROFILE_LIMIT');
        profiles.push(profile);
      });
    },
    update(uid, id, data) {
      if (!validId(id)) throw new HttpError(400, 'INVALID_PROFILE_ID');
      const patch = validate(data, true);
      return mutate(uid, profiles => {
        const profile = profiles.find(value => value.id === id);
        if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND');
        Object.assign(profile, patch);
      });
    },
    remove(uid, id) {
      if (!validId(id)) throw new HttpError(400, 'INVALID_PROFILE_ID');
      return mutate(uid, profiles => {
        const index = profiles.findIndex(value => value.id === id);
        if (index < 0) throw new HttpError(404, 'PROFILE_NOT_FOUND');
        profiles.splice(index, 1);
      });
    }
  };
}

function createPersonalStore({ getFirestore, profiles }) {
  const reference = (db, uid, id) => db.collection('viewerAccounts').doc(encodeURIComponent(uid)).collection('personal').doc(id);

  function stored(value) {
    const state = value || model.empty();
    if (!model.validState(state)) throw new HttpError(503, 'PERSONAL_STORAGE_INVALID');
    return state;
  }

  async function requireMembership(uid, id) {
    if (id !== 'primary' && !(await profiles.read(uid)).some(profile => profile.id === id)) {
      throw new HttpError(404, 'PROFILE_NOT_FOUND');
    }
  }

  async function ensureMembership(transaction, db, uid, id) {
    if (id === 'primary' || !profiles.cloud) return;
    const account = (await transaction.get(db.collection('viewerAccounts').doc(encodeURIComponent(uid)))).data();
    if (!account?.profiles?.some(profile => profile.id === id)) throw new HttpError(404, 'PROFILE_NOT_FOUND');
  }

  function validateBatch(device, operations) {
    if (typeof device !== 'string' || !validId(device) || !Array.isArray(operations) || !operations.length || operations.length > 50) {
      throw new HttpError(400, 'INVALID_PERSONAL_OPERATION');
    }
    try {
      for (const operation of operations) {
        model.validate(operation);
        if (!Number.isSafeInteger(operation.seq) || operation.seq < 1) throw new Error('Invalid sequence');
      }
    } catch {
      throw new HttpError(400, 'INVALID_PERSONAL_OPERATION');
    }
  }

  function applyBatch(state, device, operations) {
    let last = state.cursors[device] || 0;
    if (!state.cursors[device] && Object.keys(state.cursors).length >= 128) {
      throw new HttpError(409, 'PERSONAL_DEVICE_LIMIT');
    }
    for (const operation of operations) {
      if (operation.seq <= last) continue;
      if (operation.seq !== last + 1) throw new HttpError(409, 'PERSONAL_SEQUENCE_CONFLICT');
      try {
        model.apply(state, operation);
      } catch (error) {
        // The whole transaction rolls back. Only an explicit server refusal lets the
        // client replace this sequence with a durable no-op, without renumbering.
        if (model.isTerminalRejection(error)) {
          throw Object.assign(new HttpError(409, 'PERSONAL_OPERATION_REJECTED'), {
            rejection: { seq: operation.seq, reason: error.code }
          });
        }
        throw new HttpError(400, 'INVALID_PERSONAL_OPERATION');
      }
      last = operation.seq;
    }
    state.cursors[device] = last;
    state.revision++;
  }

  return {
    async get(uid, id) {
      await requireMembership(uid, id);
      const db = await getFirestore();
      return db.runTransaction(async transaction => {
        await ensureMembership(transaction, db, uid, id);
        return stored((await transaction.get(reference(db, uid, id))).data());
      });
    },
    async apply(uid, id, device, operations) {
      validateBatch(device, operations);
      await requireMembership(uid, id);
      const db = await getFirestore();
      const ref = reference(db, uid, id);
      return db.runTransaction(async transaction => {
        await ensureMembership(transaction, db, uid, id);
        const state = stored((await transaction.get(ref)).data());
        applyBatch(state, device, operations);
        transaction.set(ref, state);
        return state;
      });
    }
  };
}

module.exports = { createCloudProfiles, createPersonalStore };
