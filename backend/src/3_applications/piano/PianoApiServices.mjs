import { buildExerciseCatalog } from '#shared/music/exerciseCatalog.mjs';
import { countInstances, expandSeed, instanceId, instanceIds, materializeById, searchBank } from '#shared/music/exerciseBank.mjs';
import { validateAssessment } from '#shared/music/assessmentRecord.mjs';
import { musicXmlToNotes } from '#shared/music/musicXmlToNotes.mjs';
import { getManifest } from './loopManifest.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function mergeBuckets(current = {}, patch = {}) {
  const result = { ...current };
  for (const bucket of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(bucket)) continue;
    result[bucket] = { ...(current?.[bucket] || {}), ...(patch[bucket] || {}) };
  }
  return result;
}

export class PianoStudioService {
  constructor({ datastore, createId, clock = () => new Date() }) {
    this.datastore = datastore;
    this.createId = createId;
    this.clock = clock;
  }

  isKnownUser(userId) { return this.datastore.isKnownUser(userId); }
  roster() { return this.datastore.getRoster(); }
  loopManifest(options) { return getManifest(this.datastore, options); }
  listTakes(userId) { return this.datastore.listStudioTakes(userId); }
  getTake(userId, id) { return this.datastore.getStudioTake(userId, id); }
  createTake(userId, { title, durationMs, events }) {
    const id = this.createId();
    const data = {
      id, userId, title: title || `Take ${id}`, created: this.clock().toISOString(),
      durationMs: Number(durationMs) || 0, events,
    };
    this.datastore.saveStudioTake(userId, id, data);
    return data;
  }
  curateTake(userId, id, { title, favorite }) {
    const data = this.datastore.getStudioTake(userId, id);
    if (!data) return null;
    if (typeof title === 'string' && title.trim()) data.title = title.trim();
    if (typeof favorite === 'boolean') data.favorite = favorite;
    this.datastore.saveStudioTake(userId, id, data);
    return { id, title: data.title, favorite: !!data.favorite };
  }
  deleteTake(userId, id) { return this.datastore.deleteStudioTake(userId, id); }

  getPreferences(userId) { return this.datastore.getPreferences(userId); }
  mergePreferences(userId, patch) {
    const current = this.datastore.getPreferences(userId);
    if (current === null) return null;
    const merged = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
    this.datastore.savePreferences(userId, merged);
    return merged;
  }
  getPreset(userId) { return this.datastore.getPreset(userId); }
  mergePreset(userId, patch) {
    const current = this.datastore.getPreset(userId);
    if (current === null) return null;
    const merged = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
    this.datastore.savePreset(userId, merged);
    return merged;
  }

  getPractice(userId, scoreKey) { return this.datastore.getPractice(userId, scoreKey); }
  recordPractice(userId, scoreKey, patch) {
    const current = this.datastore.getPractice(userId, scoreKey);
    if (current === null) return null;
    const body = patch && typeof patch === 'object' ? patch : {};
    const fingerprintChanged = body.fingerprint && current.fingerprint
      && (typeof body.fingerprint.contentSha256 === 'string'
        ? body.fingerprint.contentSha256 !== current.fingerprint.contentSha256
        : body.fingerprint.measureCount !== current.fingerprint.measureCount
          || body.fingerprint.xmlBytes !== current.fingerprint.xmlBytes);
    const updatedAt = this.clock().toISOString();
    const merged = fingerprintChanged ? { ...body, updatedAt } : {
      ...current,
      ...body,
      measures: { ...(current.measures || {}), ...(body.measures || {}) },
      polish: mergeBuckets(current.polish, body.polish),
      updatedAt,
    };
    this.datastore.savePractice(userId, scoreKey, merged);
    return merged;
  }

  getProgress(userId) { return this.datastore.getProgress(userId); }
  recordProgress(userId, collection, drillId, patch) {
    const progress = this.datastore.getProgress(userId) || { collections: {} };
    if (!progress.collections) progress.collections = {};
    const group = progress.collections[collection] || (progress.collections[collection] = {});
    const previous = group[drillId] || {};
    group[drillId] = {
      ...previous,
      ...(patch && typeof patch === 'object' ? patch : {}),
      lastPlayed: this.clock().toISOString(),
      plays: (previous.plays || 0) + 1,
    };
    this.datastore.saveProgress(userId, progress);
    return group[drillId];
  }

  lessonIndex(collection) { return this.datastore.getLessonIndex(collection); }
  lessonDrill(collection, id) { return this.datastore.getLessonDrill(collection, id); }
  writeHistory(userId, date, takeId, events) { return this.datastore.writeHistoryMidi(userId, date, takeId, events); }
  writeEffectClip(runId, label, bytes) { return this.datastore.writeEffectAuditClip(runId, label, bytes); }
  writeEffectManifest(runId, manifest) { return this.datastore.writeEffectAuditManifest(runId, manifest); }
}

export class PianoCompositionService {
  constructor({ store }) { this.store = store; }
  isKnownUser(userId) { return this.store.isKnownUser(userId); }
  list(userId) { return this.store.list(userId); }
  get(userId, id) { return this.store.get(userId, id); }
  create(userId, value) { return this.store.create(userId, value); }
  save(userId, id, value) { return this.store.save(userId, id, value); }
  remove(userId, id) { return this.store.remove(userId, id); }
  listShared() { return this.store.listShared(); }
  acceptsMusicXml(xml) {
    if (typeof xml !== 'string' || !xml.includes('<score-partwise')) return false;
    try { musicXmlToNotes(xml); return true; } catch { return false; }
  }
}

export class PianoAttemptService {
  constructor({ store = null, createId, userDirectory, clock, logger = console }) {
    if (!clock?.now) throw new TypeError('PianoAttemptService requires clock');
    this.store = store;
    this.createId = createId;
    this.userDirectory = userDirectory;
    this.clock = clock;
    this.logger = logger;
  }
  get available() { return Boolean(this.store); }
  list(userId, filters) { return this.store.list(userId, filters); }
  save(userId, body) {
    return this.store.save(userId, {
      ...body,
      attempt_id: body.attempt_id || this.createId(),
      trust_source: 'client-midi',
    });
  }

  #authority(viewer, userId) {
    const writerRoles = new Set(['sysadmin', 'parent', 'kiosk', 'piano-instructor', 'gaming-host']);
    const roles = new Set((viewer?.roles || []).map(String));
    const participantId = viewer?.participantId == null ? null : String(viewer.participantId);
    const trustedWriter = [...roles].some((role) => writerRoles.has(role));
    if (trustedWriter || participantId === String(userId)) return { allowed: true };
    return { allowed: false, authenticated: Boolean(participantId || roles.size) };
  }

  authorizeUser({ userId, viewer, allowGuest = true }) {
    if (!this.#knownUser(userId) || (!allowGuest && userId === 'guest')) return { kind: 'invalid_user' };
    const authority = this.#authority(viewer, userId);
    if (!authority.allowed) return { kind: authority.authenticated ? 'forbidden' : 'unauthenticated' };
    return { kind: 'authorized' };
  }

  acceptsPassedAssessment(input, { maxAssessmentIdLength = null } = {}) {
    const assessmentId = typeof input?.assessmentId === 'string' ? input.assessmentId.trim() : '';
    const score = input?.score;
    return Boolean(assessmentId)
      && (maxAssessmentIdLength == null || assessmentId.length <= maxAssessmentIdLength)
      && input?.status === 'completed' && input?.passed === true
      && typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
  }

  #knownUser(userId) {
    return userId === 'guest' || this.userDirectory.isKnownUser(userId);
  }

  #telemetry(attempt, persistence, extra = {}) {
    return {
      attemptId: attempt?.attempt_id ?? null,
      surface: attempt?.context?.surface ?? null,
      matcher: attempt?.context?.matcher ?? null,
      mode: attempt?.context?.mode ?? attempt?.assessment?.mode ?? attempt?.prompt?.mode ?? null,
      activityId: attempt?.activity_id ?? null,
      challengeId: attempt?.challenge_id ?? null,
      purpose: attempt?.purpose ?? null,
      terminalStatus: attempt?.status ?? null,
      score: attempt?.score ?? null,
      passed: attempt?.verdict?.passed ?? null,
      criteria: attempt?.criteria ?? null,
      rubricId: attempt?.rubric?.id ?? attempt?.grading_policy_version ?? null,
      rubricVersion: attempt?.rubric?.version ?? null,
      providerVersion: attempt?.provider_version ?? null,
      partWeights: attempt?.rubric?.part_weights ?? null,
      failedCriteria: attempt?.verdict?.failed_criteria ?? [],
      failedGates: attempt?.verdict?.failed_gates ?? [],
      gates: attempt?.gates ?? null,
      expectedNotes: attempt?.diagnostics?.expected_notes ?? null,
      matchedNotes: attempt?.diagnostics?.matched_notes ?? null,
      wrongNotes: attempt?.diagnostics?.wrong_notes ?? null,
      missedNotes: attempt?.diagnostics?.missed_notes ?? null,
      responseMedianMs: attempt?.diagnostics?.response_median_ms ?? null,
      persistence,
      ...extra,
    };
  }

  listAuthorized({ userId, viewer, filters }) {
    if (!this.available) return { kind: 'unavailable' };
    if (!this.#knownUser(userId)) return { kind: 'invalid_user' };
    const authority = this.#authority(viewer, userId);
    if (!authority.allowed) return { kind: authority.authenticated ? 'forbidden' : 'unauthenticated' };
    if (userId === 'guest') return { kind: 'listed', attempts: [] };
    return { kind: 'listed', attempts: this.list(userId, filters) };
  }

  submitAuthorized({ userId, viewer, body }) {
    if (!this.available) {
      this.logger.error?.('piano.attempt.failed', this.#telemetry(body, 'failed', {
        userId, persistenceDurationMs: 0, persistenceError: 'attempt-store-unavailable',
      }));
      return { kind: 'unavailable' };
    }
    if (!this.#knownUser(userId)) {
      this.logger.warn?.('piano.attempt.rejected', this.#telemetry(body, 'rejected', {
        userId, validationErrors: ['invalid-user'],
      }));
      return { kind: 'invalid_user' };
    }
    const authority = this.#authority(viewer, userId);
    if (!authority.allowed) {
      this.logger.warn?.('piano.attempt.rejected', this.#telemetry(body, 'rejected', {
        userId, validationErrors: ['authorization-denied'],
      }));
      return { kind: authority.authenticated ? 'forbidden' : 'unauthenticated' };
    }

    const assessment = validateAssessment(body);
    const hasIdentity = (typeof body.challenge_id === 'string' && body.challenge_id.trim())
      || (typeof body.activity_id === 'string' && body.activity_id.trim());
    const policyErrors = [];
    if (!['practice', 'challenge'].includes(body?.purpose)) policyErrors.push('purpose-required');
    if (body?.purpose === 'practice' && !(typeof body.activity_id === 'string' && body.activity_id.trim())) policyErrors.push('practice-activity-required');
    if (body?.purpose === 'challenge' && !(typeof body.challenge_id === 'string' && body.challenge_id.trim())) policyErrors.push('challenge-identity-required');
    if (userId === 'guest') {
      if (body?.purpose !== 'challenge') policyErrors.push('guest-challenge-only');
      if (body?.context?.surface !== 'piano-challenge') policyErrors.push('guest-surface-not-authorized');
    }
    if (!assessment.valid || !hasIdentity || policyErrors.length) {
      const errors = [...assessment.errors, ...(!hasIdentity ? ['challenge_id or activity_id is required'] : []), ...policyErrors];
      this.logger.warn?.('piano.attempt.rejected', this.#telemetry(body, 'rejected', { validationErrors: errors }));
      return { kind: 'invalid', errors };
    }

    const startedAt = this.clock.now();
    try {
      const attempt = this.save(userId, body);
      this.logger.info?.('piano.attempt.saved', {
        userId, status: attempt.status, rubric: attempt.rubric?.id ?? null,
        ...this.#telemetry(attempt, 'saved', { persistenceDurationMs: Math.max(0, this.clock.now() - startedAt) }),
      });
      return { kind: 'saved', attempt };
    } catch (error) {
      const metadata = this.#telemetry(body, 'failed', {
        userId, persistenceDurationMs: Math.max(0, this.clock.now() - startedAt),
        persistenceError: error?.message || String(error),
      });
      this.logger.error?.('piano.attempt.failed', metadata);
      throw error;
    }
  }
}

export class PianoExerciseService {
  constructor({ bank = null }) { this.bank = bank; }
  get available() { return Boolean(this.bank?.available()); }
  index() { return this.bank.getIndex() || { categories: this.bank.listCategories() }; }
  catalog() { return buildExerciseCatalog(this.bank); }
  search(filters) { return searchBank(this.bank.allSeeds(), filters); }
  getSeed(path) { return this.bank.getSeed(path); }
  seed(path) {
    const seed = this.bank.getSeed(path);
    return seed ? { ...seed, instances: countInstances(seed) } : null;
  }
  category(path) {
    const category = this.bank.getCategory(path);
    return category ? {
      ...category,
      seeds: this.bank.listSeeds(path),
      categories: this.bank.listCategories(path),
    } : null;
  }
  instances(seed, { limit, expand }) {
    if (expand) return { seed_id: seed.id, total: countInstances(seed), instances: expandSeed(seed, { limit }) };
    const ids = instanceIds(seed);
    return { seed_id: seed.id, total: ids.length, instance_ids: ids.slice(0, limit) };
  }
  instance(seed, axes) { return materializeById(seed, instanceId(seed.id, axes)); }
}

export class PianoCourseService {
  constructor({ container }) { this.container = container; }
  get coursesAvailable() { return this.container.isCourseServiceConfigured(); }
  get activityAvailable() { return this.container.isActivityConfigured(); }
  async progress(ids) { return (await this.container.getCourseProgress().execute({ ids })).courses; }
  playable(courseId, userId) { return this.container.getPlayableUnits().execute({ courseId, userId }); }
  activity() { return this.container.getRecentCourseActivity().execute(); }
}

export class PianoCompletionNotifier {
  constructor({ completionPublisher = null }) { this.completionPublisher = completionPublisher; }
  schoolChallengeCompleted({ userId, descriptorId, completedAt }) {
    this.completionPublisher?.publishSchoolChallengeCompleted({ userId, descriptorId, completedAt });
  }
}

export class PianoProducerService {
  constructor({ datastore, createId, records, clock = () => new Date(), logger = console }) {
    this.datastore = datastore;
    this.createId = createId;
    this.records = records;
    this.clock = clock;
    this.logger = logger;
  }

  inspect(family, id, raw) {
    const hasLoop = (loopId) => {
      const loop = this.datastore.getProducer('loops', loopId);
      return !!loop && loop.id === loopId && this.records.validateProducerRecord('loops', loop).length === 0;
    };
    const errors = raw && typeof raw === 'object'
      ? this.records.validateProducerRecord(family, raw, { hasLoop })
      : ['record must be an object'];
    if (raw?.id !== id) errors.unshift(`id must match filename: ${id}`);
    return { data: raw, errors };
  }

  invalid(family, id, errors) {
    this.logger.error?.('piano.producer.stored-invalid', { family, id, errors });
    return { id, errors };
  }

  list(family) {
    const records = [];
    const invalidRecords = [];
    for (const { id, data } of this.datastore.listProducer(family)) {
      const inspected = this.inspect(family, id, data);
      if (inspected.errors.length) invalidRecords.push(this.invalid(family, id, inspected.errors));
      else records.push({ id, data: inspected.data });
    }
    return { records, invalidRecords };
  }

  listLight(family) {
    const result = this.list(family);
    return { ...result, records: result.records.map(({ id, data }) => ({ id, data: producerLight(family, id, data) })) };
  }

  get(family, id) {
    const raw = this.datastore.getProducer(family, id);
    if (!raw) return { kind: 'not_found' };
    const inspected = this.inspect(family, id, raw);
    if (inspected.errors.length) {
      this.invalid(family, id, inspected.errors);
      return { kind: 'invalid_stored', id, errors: inspected.errors };
    }
    return { kind: 'found', data: inspected.data };
  }

  create(family, payload) {
    const id = this.createId().toLowerCase();
    const now = this.clock().toISOString();
    const data = this.records.normalizeProducerRecord(family, { ...payload, id, created: now }, { id });
    const errors = this.inspect(family, id, data).errors;
    if (errors.length) return { kind: 'invalid', errors };
    if (data.dedupeKey && family !== 'songs') {
      const existing = this.datastore.listProducer(family).find(({ id: candidateId, data: candidate }) => {
        const inspected = this.inspect(family, candidateId, candidate);
        return inspected.errors.length === 0 && candidate.dedupeKey === data.dedupeKey;
      });
      if (existing) return { kind: 'deduped', data: existing.data };
    }
    this.datastore.saveProducer(family, id, data);
    return { kind: 'created', data };
  }

  patch(family, id, patch) {
    const current = this.get(family, id);
    if (current.kind !== 'found') return current;
    const currentRevision = Number.isInteger(current.data.revision) ? current.data.revision : 1;
    if (patch.expectedRevision != null && patch.expectedRevision !== currentRevision) {
      return { kind: 'conflict', current: currentRevision };
    }
    const {
      id: _id, author: _author, created: _created, schemaVersion: _schemaVersion,
      revision: _revision, modified: _modified, contentHash: _contentHash,
      dedupeKey: _dedupeKey, expectedRevision: _expectedRevision, ...mergeable
    } = patch;
    const now = this.clock().toISOString();
    const data = this.records.normalizeProducerRecord(family, {
      ...current.data,
      ...mergeable,
      title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.data.title,
      favorite: typeof patch.favorite === 'boolean' ? patch.favorite : current.data.favorite,
      schemaVersion: this.records.PRODUCER_SCHEMA_VERSION,
      revision: currentRevision + 1,
      modified: now,
    }, { id, now });
    const errors = this.inspect(family, id, data).errors;
    if (errors.length) return { kind: 'invalid', errors };
    this.datastore.saveProducer(family, id, data);
    return { kind: 'saved', data };
  }

  delete(family, id) { return this.datastore.deleteProducer(family, id); }
}

function producerLight(family, id, data) {
  const light = {
    id, kind: data.kind ?? null, author: data.author ?? null,
    created: data.created ?? null, modified: data.modified ?? null,
    revision: data.revision, schemaVersion: data.schemaVersion, contentHash: data.contentHash,
  };
  if (data.title != null) light.title = data.title;
  if (typeof data.favorite === 'boolean') light.favorite = data.favorite;
  if (family === 'loops') {
    light.ppq = data.ppq ?? null;
    light.lengthBars = data.lengthBars ?? null;
    if (data.specificity != null) light.specificity = data.specificity;
    if (data.drumMode != null) light.drumMode = data.drumMode;
  } else if (family === 'crate') {
    light.lengthBars = data.lengthBars ?? null;
    light.layerCount = Array.isArray(data.layers) ? data.layers.length : 0;
  } else if (family === 'songs') {
    light.sectionCount = Array.isArray(data.sections) ? data.sections.length : 0;
    if (data.meta != null) light.meta = data.meta;
  }
  return light;
}

export function createPianoApiServices({ studioDatastore, composerSongStore, pianoCourseContainer, createId, producerRecords, pianoAttemptStore = null, exerciseBank = null, completionPublisher = null, clock, logger = console }) {
  return {
    pianoStudioService: new PianoStudioService({ datastore: studioDatastore, createId }),
    pianoCompositionService: new PianoCompositionService({ store: composerSongStore }),
    pianoAttemptService: new PianoAttemptService({ store: pianoAttemptStore, createId, userDirectory: studioDatastore, clock, logger }),
    pianoExerciseService: new PianoExerciseService({ bank: exerciseBank }),
    pianoCourseService: new PianoCourseService({ container: pianoCourseContainer }),
    pianoCompletionNotifier: new PianoCompletionNotifier({ completionPublisher }),
    pianoProducerService: new PianoProducerService({ datastore: studioDatastore, createId, records: producerRecords, logger }),
  };
}
