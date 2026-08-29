/**
 * PianoChallengeProfileService — the small, durable learner-owned part of a
 * PianoChallenge profile.
 *
 * A placement run is allowed to choose where a learner enters the existing
 * game-gate repertoire.  It is not allowed to rewrite that repertoire, nor to
 * persist a whole opaque preferences document supplied by the browser.  This
 * service owns that narrow write and keeps it under one namespaced preference
 * key until the profile grows into a richer domain record.
 */
import { InvalidInputError } from '#apps/common/errors/SemanticErrors.mjs';

const START_LEVEL_MAX_LENGTH = 120;

function normalizeStartLevel(value) {
  if (typeof value !== 'string') return null;
  const startLevel = value.trim();
  if (!startLevel || startLevel.length > START_LEVEL_MAX_LENGTH) return null;
  return startLevel;
}

export class PianoChallengeProfileService {
  #datastore;

  constructor({ datastore } = {}) {
    if (!datastore || typeof datastore.getPreferences !== 'function' || typeof datastore.savePreferences !== 'function') {
      throw new Error('PianoChallengeProfileService requires a piano preferences datastore');
    }
    this.#datastore = datastore;
  }

  get({ learnerId } = {}) {
    const preferences = this.#datastore.getPreferences(learnerId);
    if (preferences === null) return null;
    return { startLevel: normalizeStartLevel(preferences?.pianoChallenge?.startLevel) };
  }

  setStartLevel({ learnerId, startLevel } = {}) {
    const normalized = normalizeStartLevel(startLevel);
    if (!normalized) {
      throw new InvalidInputError('startLevel must be a non-empty level id', { code: 'invalid_start_level' });
    }
    const current = this.#datastore.getPreferences(learnerId);
    if (current === null) {
      throw new InvalidInputError('Invalid user', { code: 'invalid_user' });
    }
    const next = {
      ...current,
      pianoChallenge: { ...(current.pianoChallenge || {}), startLevel: normalized },
    };
    const saved = this.#datastore.savePreferences(learnerId, next);
    if (saved === false) throw new Error('PianoChallenge profile could not be saved');
    return { startLevel: normalized };
  }
}

export default PianoChallengeProfileService;
