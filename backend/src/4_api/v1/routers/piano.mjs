import express from 'express';
import { shortId } from '#domains/core/utils/id.mjs';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';
import { musicXmlToNotes } from '#shared/music/musicXmlToNotes.mjs';
import { countInstances, expandSeed, instanceId, instanceIds, materializeById, searchBank } from '#shared/music/exerciseBank.mjs';
import { validateAssessment } from '#shared/music/assessmentRecord.mjs';
import { buildExerciseCatalog } from '#shared/music/exerciseCatalog.mjs';
import {
  PRODUCER_ID_RE,
  PRODUCER_SCHEMA_VERSION,
  normalizeProducerRecord,
  validateProducerRecord,
} from '#apps/piano/producerRecords.mjs';

const ATTEMPT_WRITER_ROLES = new Set(['sysadmin', 'parent', 'kiosk', 'piano-instructor', 'gaming-host']);
const GUEST_ATTEMPT_SURFACES = new Set(['piano-challenge']);

function pianoAttemptAuthority(req, userId) {
  const roles = new Set([...(req.roles || []), ...(req.user?.roles || [])].map(String));
  const participantId = req.user?.sub == null ? null : String(req.user.sub);
  const trustedWriter = [...roles].some((role) => ATTEMPT_WRITER_ROLES.has(role));
  if (trustedWriter || participantId === String(userId)) return { allowed: true, trustedWriter, participantId };
  return { allowed: false, status: participantId || roles.size ? 403 : 401 };
}

function attemptPolicyErrors(userId, body) {
  const errors = [];
  if (!['practice', 'challenge'].includes(body?.purpose)) errors.push('purpose-required');
  if (body?.purpose === 'practice' && !(typeof body.activity_id === 'string' && body.activity_id.trim())) errors.push('practice-activity-required');
  if (body?.purpose === 'challenge' && !(typeof body.challenge_id === 'string' && body.challenge_id.trim())) errors.push('challenge-identity-required');
  if (userId === 'guest') {
    if (body?.purpose !== 'challenge') errors.push('guest-challenge-only');
    if (!GUEST_ATTEMPT_SURFACES.has(body?.context?.surface)) errors.push('guest-surface-not-authorized');
  }
  return errors;
}

/**
 * Piano kiosk API.
 *
 * Per-user, not per-device: the piano has a roster (household.yml → users,
 * mirroring fitness) and each player gets their own recordings, lesson progress,
 * and preferences under data/users/{id}/apps/piano/. The browser owns Web-MIDI;
 * this layer is plain CRUD.
 *
 * Persistence + path building live in the injected PianoContainer's
 * `studioDatastore` (YamlPianoStudioDatastore); the two orchestrating course
 * algorithms live in the container's GetCourseProgress / GetPlayableUnits use
 * cases. This router is thin: input validation + delegation + response shaping.
 * URL paths and response bodies are contract-stable (the kiosk depends on them —
 * see docs/reference/piano/producer.md).
 *
 * Routes (mounted at /api/v1/piano):
 *   GET    /users                          → [{ id, name, group_label }]  (roster)
 *
 *   Studio takes (recordings), scoped to a user:
 *   GET    /users/:userId/studio           → { takes: [{id,title,created,durationMs,eventCount,favorite}] }
 *   GET    /users/:userId/studio/:id        → full take (events)
 *   POST   /users/:userId/studio            → { id, ... }  (body: { title, durationMs, events })
 *   PATCH  /users/:userId/studio/:id        → curate (body: { title?, favorite? })
 *   DELETE /users/:userId/studio/:id        → { ok, id }
 *
 *   Compositions (Composer mode), scoped to a user:
 *   GET    /users/:userId/compositions          → { compositions: [{id,title,tags,share,updatedAt,revision}] }
 *   GET    /users/:userId/compositions/:id       → { meta, musicxml }
 *   POST   /users/:userId/compositions           → 201 record  (body: { title, musicxml, meta }; 400 on invalid xml)
 *   PUT    /users/:userId/compositions/:id       → { ok, revision }  (body: { musicxml, meta, revision }; 400 invalid xml, 409 stale revision)
 *   DELETE /users/:userId/compositions/:id       → { ok, id }
 *   GET    /compositions/shared                  → { compositions: [{userId,id,title,tags}] }  (household pool)
 *
 *   Preferences (voice, shaders, etc.) — opaque per-user blob:
 *   GET    /users/:userId/preferences       → { ...prefs }
 *   PUT    /users/:userId/preferences        → { ...prefs }  (body merged)
 *
 *   Sound preset (default voice/effects/volume + saved favorites) — opaque per-user blob:
 *   GET    /users/:userId/preset             → { default?, favorites? }
 *   PUT    /users/:userId/preset             → { default?, favorites? }  (body merged)
 *
 *   Practice history (per-user, per-score sheet-music record; wave-3 §C):
 *   GET    /users/:userId/practice/:scoreKey → {} or the stored record
 *   PUT    /users/:userId/practice/:scoreKey → merged record (measures per-key,
 *          polish per-bucket, updatedAt server-stamped; a changed fingerprint
 *          replaces the record instead of merging — see route for detail)
 *
 *   Lesson progress / history:
 *   GET    /users/:userId/progress           → { collections: { [collection]: { [drillId]: {...} } } }
 *   PUT    /users/:userId/progress/:collection/:drillId → record an attempt (body merged)
 *
 *   Lesson drills (content, read-only):
 *   GET    /lessons/:collection              → index
 *   GET    /lessons/:collection/:id          → drill module
 *
 *   Exercise bank (content, read-only; seeds stored, instances computed).
 *   Categories nest, so <path> is any depth — `chords`, `drills/hanon`:
 *   GET    /bank                                 → categories + totals
 *   GET    /bank/search?level_min&level_max&mode&form&hands&collection&tags
 *   GET    /bank/<path>                          → a category index, or a seed
 *   GET    /bank/<seed>/instances                → instance ids (?limit, ?expand=true)
 *   GET    /bank/<seed>/instance?<axes>          → one materialized instance
 *
 *   Menu activity strip:
 *   GET    /activity/recent                  → { players: [...] }  (per-player most-recent lesson-course progress)
 *
 *   Game-time budget (server is the source of truth; unwired service fails open):
 *   GET    /users/:userId/game-budget                          → live balance ({enabled:false} if unwired/off)
 *   POST   /users/:userId/game-budget/session                  → open/adopt a session ({sessionId,cumulativeSeconds,...})
 *   POST   /users/:userId/game-budget/session/:sessionId/settle → charge up to cumulativeSeconds ({secondsLeft,depleted,deviceDepleted})
 *   POST   /users/:userId/game-budget/session/:sessionId/close  → seal a session ({ok:true})
 *   POST   /users/:userId/game-budget/credits                   → idempotently mint earned time for a passed assessment
 */
export function createPianoRouter({ pianoContainer, pianoAttemptStore = null, pianoChallengePolicy = null, pianoChallengeProfileService = null, schoolPianoChallengeCompletionService = null, pianoLearningService = null, pianoGameBudgetService = null, pianoBoardGameDayService = null, exerciseBank = null, eventBus = null, logger = console }) {
  if (!pianoContainer) throw new Error('createPianoRouter: pianoContainer required');
  const router = express.Router();
  const ds = pianoContainer.studioDatastore;
  const cs = pianoContainer.composerSongStore;

  // Pure, config-free path-segment guards (HTTP input validation stays here).
  const safeSegment = (s) => typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');

  // Game-budget cumulativeSeconds guard. `Number(x) || 0` (the shape this
  // came in with) collapses BOTH directions of bad input into something that
  // silently corrupts the balance: garbage (`undefined`/`"abc"`/`null` — the
  // last of those coerces via `Number(null) === 0`, so a loose `Number.isFinite`
  // check alone still lets it through as a *silently accepted* zero-charge,
  // not a rejection) folds to 0 — a swallowed debit, i.e. free game time
  // (D16) — while `1e400`/oversized-but-finite input folds to `Infinity`/a
  // huge finite number that `applySettle` adds into BOTH the learner total
  // and the single GLOBAL `day.device.totalSeconds`, zeroing every learner's
  // remaining device time for the rest of the day, not just the caller's.
  // Requiring `typeof raw === 'number'` up front rejects every non-numeric
  // shape outright (400); clamping below defends the numeric-but-absurd case
  // (a huge finite value) to a day's worth of seconds so no single request
  // can out-charge a plausible day.
  const MAX_SETTLE_SECONDS = 86400;
  const parseCumulativeSeconds = (body) => {
    const raw = body?.cumulativeSeconds;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    return Math.min(raw, MAX_SETTLE_SECONDS);
  };

  // Game-budget sessionId guard. `sessionId` is the one client-controlled
  // segment on the settle/close routes that reaches `day.sessions[sessionId]`
  // in the domain layer (gameBudget.mjs) — and a plain object keyed straight
  // from that string is a prototype-pollution vector: `'__proto__'` reads
  // back `Object.prototype` itself (truthy, sails past `if (!s) throw`), and
  // `'constructor'`/`'prototype'` are the same class of bug via other
  // inherited/own properties. The domain layer now rejects these via
  // `Object.hasOwn` regardless (defense where the lookup happens), but
  // `safeSegment` — this file's existing path-segment guard — does NOT catch
  // any of the three (it only blocks `/`, `\`, and `..`), so it must not be
  // reused here and mistaken for coverage. This is a dedicated guard so a
  // pollution attempt gets a clean 400 at the boundary instead of a domain
  // throw.
  const UNSAFE_SESSION_IDS = new Set(['__proto__', 'constructor', 'prototype']);
  const safeSessionId = (s) => typeof s === 'string' && s.length > 0 && !UNSAFE_SESSION_IDS.has(s);

  // Write-gate: reject a musicxml payload the app can't read back. The real bar
  // (spec §4) is "well-formed score", NOT "has notes" — a brand-new song from
  // NewSongSetup's makeEmptyScore() is a valid score with 0 notes and must be
  // accepted. musicXmlToNotes is a permissive regex scanner: it does NOT throw
  // on garbage (e.g. '<not-a-score/>' silently parses to `{notes:[]}`, same
  // shape as a valid empty score), so "doesn't throw" can't discriminate the
  // two — verified via a direct call. The real discriminator is structural:
  // every genuine score carries the <score-partwise> root element; garbage
  // doesn't.
  const isValidScore = (xml) => {
    if (typeof xml !== 'string' || !xml.includes('<score-partwise')) return false;
    try { musicXmlToNotes(xml); return true; }
    catch { return false; }
  };

  // Keep attempt logs structurally identical across validation, persistence,
  // and storage failures. Deliberately omit prompt/events and every raw MIDI
  // field; the numeric summary is enough to operate the pipeline.
  const attemptTelemetry = (attempt, persistence, extra = {}) => ({
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
  });

  // ── Roster ────────────────────────────────────────────────────────────────
  router.get('/users', asyncHandler((req, res) => {
    res.json({ users: ds.getRoster() });
  }));

  // Challenge-provider attempt ledger. Gaming stores only the returned id and
  // immutable result snapshot; piano owns the durable practice evidence.
  router.get('/users/:userId/attempts', asyncHandler((req, res) => {
    if (!pianoAttemptStore) return res.status(501).json({ error: 'Attempt store unavailable' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Attempt access denied' });
    if (req.params.userId === 'guest') return res.json({ attempts: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);
    const attempts = pianoAttemptStore.list(req.params.userId, {
      limit,
      exerciseId: typeof req.query.exercise_id === 'string' ? req.query.exercise_id : null,
      purpose: typeof req.query.purpose === 'string' ? req.query.purpose : null,
      context: typeof req.query.context === 'string' ? req.query.context : null,
    });
    res.json({ attempts });
  }));

  router.post('/users/:userId/attempts', asyncHandler((req, res) => {
    const body = req.body || {};
    if (!pianoAttemptStore) {
      logger.error?.('piano.attempt.failed', attemptTelemetry(body, 'failed', {
        userId: req.params.userId,
        persistenceDurationMs: 0,
        persistenceError: 'attempt-store-unavailable',
      }));
      return res.status(501).json({ error: 'Attempt store unavailable' });
    }
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      logger.warn?.('piano.attempt.rejected', attemptTelemetry(body, 'rejected', {
        userId: req.params.userId,
        validationErrors: ['invalid-user'],
      }));
      return res.status(400).json({ error: 'Invalid user' });
    }
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) {
      logger.warn?.('piano.attempt.rejected', attemptTelemetry(body, 'rejected', {
        userId: req.params.userId,
        validationErrors: ['authorization-denied'],
      }));
      return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Attempt write denied' });
    }
    // The record keeps the criterion vector, not just the scalar it projects to:
    // a score cannot be un-projected, so storing only the score makes every
    // later question about a past run unanswerable. Shape lives in shared/ so
    // the writer and the validator cannot drift.
    const assessment = validateAssessment(body);
    const hasIdentity = (typeof body.challenge_id === 'string' && body.challenge_id.trim())
      || (typeof body.activity_id === 'string' && body.activity_id.trim());
    const policyErrors = attemptPolicyErrors(req.params.userId, body);
    if (!assessment.valid || !hasIdentity || policyErrors.length) {
      const validationErrors = [
        ...assessment.errors,
        ...(!hasIdentity ? ['challenge_id or activity_id is required'] : []),
        ...policyErrors,
      ];
      logger.warn?.('piano.attempt.rejected', attemptTelemetry(body, 'rejected', {
        validationErrors,
      }));
      return res.status(400).json({
        error: 'Invalid attempt result',
        details: validationErrors,
      });
    }
    const persistenceStartedAt = Date.now();
    let attempt;
    try {
      attempt = pianoAttemptStore.save(req.params.userId, {
        ...body,
        attempt_id: body.attempt_id || shortId(),
        trust_source: 'client-midi',
      });
    } catch (error) {
      const status = Number(error?.status ?? error?.statusCode);
      if (status >= 400 && status < 500) {
        logger.warn?.('piano.attempt.rejected', attemptTelemetry(body, 'rejected', {
          userId: req.params.userId,
          validationErrors: [error?.code || 'persistence-conflict'],
          persistenceDurationMs: Math.max(0, Date.now() - persistenceStartedAt),
        }));
      } else {
        logger.error?.('piano.attempt.failed', attemptTelemetry(body, 'failed', {
          persistenceDurationMs: Math.max(0, Date.now() - persistenceStartedAt),
          persistenceError: error?.message || String(error),
        }));
      }
      throw error;
    }
    logger.info?.('piano.attempt.saved', {
      userId: req.params.userId,
      status: attempt.status,
      rubric: attempt.rubric?.id ?? null,
      ...attemptTelemetry(attempt, 'saved', {
        persistenceDurationMs: Math.max(0, Date.now() - persistenceStartedAt),
      }),
    });
    res.status(201).json(attempt);
  }));

  // --- Game-time budget (design 2026-08-27; D3: server is the source of truth) ---
  // Thin by design: the service already fails open on both "not wired" (this
  // router) and "misconfigured household" (inside the service) — these routes
  // must not re-interpret either, only pass the shape through. The
  // unwired-service check stays first in every handler (matching the
  // attempts routes' ordering) so an unwired feature short-circuits before
  // any user/body validation runs.
  router.get('/users/:userId/game-budget', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.json({ enabled: false });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    res.set('Cache-Control', 'no-store');
    res.json(await pianoGameBudgetService.balance({ learnerId: req.params.userId }));
  }));

  router.get('/users/:userId/board-game-day', asyncHandler(async (req, res) => {
    if (!pianoBoardGameDayService) return res.status(503).json({ error: 'board_game_day_unavailable' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json(pianoBoardGameDayService.current(req.params.userId));
  }));
  router.post('/users/:userId/game-budget/session', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    res.json(await pianoGameBudgetService.open({
      learnerId: req.params.userId, deviceId: req.body?.deviceId ?? null,
    }));
  }));
  router.post('/users/:userId/game-budget/session/:sessionId/settle', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    if (!safeSessionId(req.params.sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
    const cumulativeSeconds = parseCumulativeSeconds(req.body);
    if (cumulativeSeconds === null) return res.status(400).json({ error: 'Invalid cumulativeSeconds' });
    res.json(await pianoGameBudgetService.settle({
      sessionId: req.params.sessionId, learnerId: req.params.userId, cumulativeSeconds,
    }));
  }));
  router.post('/users/:userId/game-budget/session/:sessionId/close', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    if (!safeSessionId(req.params.sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
    const cumulativeSeconds = parseCumulativeSeconds(req.body);
    if (cumulativeSeconds === null) return res.status(400).json({ error: 'Invalid cumulativeSeconds' });
    res.json(await pianoGameBudgetService.close({
      sessionId: req.params.sessionId, learnerId: req.params.userId, cumulativeSeconds,
    }));
  }));
  router.post('/users/:userId/game-budget/credits', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Budget credit denied' });
    const assessmentId = typeof req.body?.assessmentId === 'string' ? req.body.assessmentId.trim() : '';
    const score = req.body?.score;
    // A host calls this only from AskSession's onPassed path. Still verify the
    // terminal result at the HTTP boundary so an aborted/timed-out payload can
    // never be converted into time merely by knowing an assessment id.
    if (!assessmentId || assessmentId.length > 200 || req.body?.status !== 'completed' || req.body?.passed !== true
      || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      return res.status(400).json({ error: 'A completed passed assessment with a 0..1 score is required' });
    }
    res.json(await pianoGameBudgetService.credit({ learnerId: req.params.userId, assessmentId, score }));
  }));

  router.post('/users/:userId/challenges/prepare', asyncHandler((req, res) => {
    if (!pianoChallengePolicy) return res.status(501).json({ error: 'Challenge policy unavailable' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    const body = req.body || {};
    if (typeof body.challenge_id !== 'string' || typeof body.kind !== 'string') {
      return res.status(400).json({ error: 'Invalid challenge request' });
    }
    const prepared = pianoChallengePolicy.prepare({
      userId: req.params.userId,
      challengeId: body.challenge_id,
      kind: body.kind,
      requirements: body.requirements,
      context: body.context,
    });
    logger.info?.('piano.challenge.prepared', {
      userId: req.params.userId,
      challengeId: body.challenge_id,
      kind: body.kind,
      policyVersion: prepared.pedagogy_policy_version,
      challengeLabel: prepared.prompt?.label || null,
    });
    res.json(prepared);
  }));

  // Placement is the only PianoChallenge flow that changes a learner's gate
  // entry point. Keep this separate from the broad opaque-preferences route:
  // callers can set one validated level id, never overwrite unrelated piano
  // preferences or household repertoire.
  router.get('/users/:userId/piano-challenge-profile', asyncHandler((req, res) => {
    if (!pianoChallengeProfileService) return res.status(501).json({ error: 'PianoChallenge profile unavailable' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Profile access denied' });
    res.set('Cache-Control', 'no-store').json(pianoChallengeProfileService.get({ learnerId: req.params.userId }));
  }));

  router.put('/users/:userId/piano-challenge-profile', asyncHandler((req, res) => {
    if (!pianoChallengeProfileService) return res.status(501).json({ error: 'PianoChallenge profile unavailable' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Profile write denied' });
    res.json(pianoChallengeProfileService.setStartLevel({
      learnerId: req.params.userId, startLevel: req.body?.startLevel,
    }));
  }));

  router.post('/users/:userId/school-piano-challenges/:descriptorId/completion', asyncHandler((req, res) => {
    if (!schoolPianoChallengeCompletionService) return res.status(501).json({ error: 'School PianoChallenge completion unavailable' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const authority = pianoAttemptAuthority(req, req.params.userId);
    if (!authority.allowed) return res.status(authority.status).json({ error: authority.status === 401 ? 'Authentication required' : 'Completion write denied' });
    const assessmentId = typeof req.body?.assessmentId === 'string' ? req.body.assessmentId.trim() : '';
    const score = req.body?.score;
    if (!assessmentId || req.body?.status !== 'completed' || req.body?.passed !== true
      || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      return res.status(400).json({ error: 'A completed passed assessment with a 0..1 score is required' });
    }
    const completion = schoolPianoChallengeCompletionService.recordPassed({
      learnerId: req.params.userId, descriptorId: req.params.descriptorId, assessmentId, score,
    });
    // The bridge re-derives whether this evidence actually settles a School
    // day before it announces anything.  This event is a wake-up, not a second
    // completion authority, and publishing retries (including duplicates) is
    // harmless because the bridge's ceremony is learner/day deduplicated.
    const publish = eventBus?.publish ?? eventBus?.broadcast;
    if (typeof publish === 'function') {
      publish.call(eventBus, 'piano.school-challenge.completed', {
        userId: req.params.userId,
        descriptorId: req.params.descriptorId,
        completedAt: completion.completedAt,
      });
    }
    res.json(completion);
  }));

  // Learning programs are policy over the bank, not another copy of its notes.
  router.get('/programs', asyncHandler((_req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    res.json({ programs: pianoLearningService.programs() });
  }));

  router.get('/programs/:programId', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    const program = pianoLearningService.program(req.params.programId);
    if (!program) return res.status(404).json({ error: 'Piano program not found' });
    res.json(program);
  }));

  router.get('/users/:userId/learning', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (!ds.isKnownUser(req.params.userId) && req.params.userId !== 'guest') return res.status(400).json({ error: 'Invalid user' });
    res.json(pianoLearningService.summary(req.params.userId));
  }));

  router.put('/users/:userId/enrollments/:programId', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (req.params.userId === 'guest') return res.status(403).json({ error: 'Choose a learner to save a program.' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    res.json({ enrollments: pianoLearningService.enroll(req.params.userId, req.params.programId) });
  }));

  router.put('/users/:userId/pending-checkpoints/:contentId', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (req.params.userId === 'guest') return res.status(403).json({ error: 'Guest checkpoints are not saved.' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    res.json({ pending_checkpoints: pianoLearningService.rememberCheckpoint(req.params.userId, {
      contentId: req.params.contentId,
      title: req.body?.title,
      courseTitle: req.body?.courseTitle,
      returnTo: req.body?.returnTo,
      requirement: req.body?.requirement,
    }) });
  }));

  router.delete('/users/:userId/enrollments/:programId', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (req.params.userId === 'guest') return res.status(403).json({ error: 'Choose a learner to change programs.' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    res.json({ enrollments: pianoLearningService.unenroll(req.params.userId, req.params.programId) });
  }));

  router.get('/users/:userId/program-assignments', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    res.json(pianoLearningService.assignment(req.params.userId));
  }));

  router.put('/users/:userId/program-assignments', asyncHandler((req, res) => {
    if (!pianoLearningService) return res.status(501).json({ error: 'Piano learning unavailable' });
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const body = req.body ?? {};
    res.json(pianoLearningService.putAssignment({
      learnerId: req.params.userId,
      programs: body.programs,
      assignedBy: body.assignedBy,
      pin: body.pin,
      baseUpdatedAt: body.baseUpdatedAt,
    }));
  }));

  // Loop-library manifest: walk the five MusicXML brick folders, bake per-beat
  // harmonic timelines (root-0, canonical-C), cache by folder mtime. This is the
  // ONE index fetch useLoopLibrary makes; individual bricks stream + parse lazily.
  router.get('/loop-manifest', asyncHandler((req, res) => {
    const bricks = ds.getLoopManifest({ refresh: req.query.refresh === 'true' });
    res.json({ bricks, count: bricks.length });
  }));

  // ── Studio takes (per-user) ─────────────────────────────────────────────────
  router.get('/users/:userId/studio', asyncHandler((req, res) => {
    const takes = ds.listStudioTakes(req.params.userId);
    if (takes === null) return res.status(400).json({ error: 'Invalid user' });
    res.json({ takes });
  }));

  router.get('/users/:userId/studio/:id', (req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getStudioTake(req.params.userId, req.params.id);
    if (!data) return res.status(404).json({ error: 'Take not found' });
    res.json(data);
  });

  router.post('/users/:userId/studio', asyncHandler((req, res) => {
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const { title, durationMs, events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events (non-empty array) required' });
    }
    const id = shortId();
    const data = {
      id,
      userId: req.params.userId,
      title: title || `Take ${id}`,
      created: new Date().toISOString(),
      durationMs: Number(durationMs) || 0,
      events,
    };
    ds.saveStudioTake(req.params.userId, id, data);
    logger.info?.('piano.studio.save', { userId: req.params.userId, id, events: events.length });
    res.status(201).json(data);
  }));

  router.patch('/users/:userId/studio/:id', asyncHandler((req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getStudioTake(req.params.userId, req.params.id);
    if (!data) return res.status(404).json({ error: 'Take not found' });
    const { title, favorite } = req.body || {};
    if (typeof title === 'string' && title.trim()) data.title = title.trim();
    if (typeof favorite === 'boolean') data.favorite = favorite;
    ds.saveStudioTake(req.params.userId, req.params.id, data);
    res.json({ id: req.params.id, title: data.title, favorite: !!data.favorite });
  }));

  router.delete('/users/:userId/studio/:id', (req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = ds.deleteStudioTake(req.params.userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Take not found' });
    res.json({ ok: true, id: req.params.id });
  });

  // ── Compositions (Composer mode, per-user) ──────────────────────────────────
  router.get('/users/:userId/compositions', asyncHandler((req, res) => {
    const list = cs.list(req.params.userId);
    if (list === null) {
      logger.warn?.('composer.song.list-invalid-user', { userId: req.params.userId });
      return res.status(400).json({ error: 'Invalid user' });
    }
    logger.info?.('composer.song.list', { userId: req.params.userId, count: list.length });
    res.json({ compositions: list });
  }));

  router.get('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const got = cs.get(req.params.userId, req.params.id);
    if (!got) {
      logger.warn?.('composer.song.get-not-found', { userId: req.params.userId, id: req.params.id });
      return res.status(404).json({ error: 'Not found' });
    }
    logger.info?.('composer.song.get', { userId: req.params.userId, id: req.params.id, revision: got.meta?.revision, xmlLen: got.musicxml?.length || 0 });
    res.json(got);
  }));

  router.post('/users/:userId/compositions', asyncHandler((req, res) => {
    if (!cs.isKnownUser(req.params.userId)) {
      logger.warn?.('composer.song.create-invalid-user', { userId: req.params.userId });
      return res.status(400).json({ error: 'Invalid user' });
    }
    const { title, musicxml, meta } = req.body || {};
    if (!isValidScore(musicxml)) {
      logger.warn?.('composer.song.create-invalid-xml', { userId: req.params.userId, xmlLen: musicxml?.length || 0 });
      return res.status(400).json({ error: 'musicxml must be a valid score' });
    }
    const rec = cs.create(req.params.userId, { title, musicxml, meta });
    logger.info?.('composer.song.create', { userId: req.params.userId, id: rec?.id, title: rec?.title, revision: rec?.revision });
    res.status(201).json(rec);
  }));

  router.put('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const { musicxml, meta, revision } = req.body || {};
    if (!isValidScore(musicxml)) {
      logger.warn?.('composer.song.save-invalid-xml', { userId: req.params.userId, id: req.params.id });
      return res.status(400).json({ error: 'musicxml failed validation' });
    }
    const r = cs.save(req.params.userId, req.params.id, { musicxml, meta, revision });
    if (r.conflict) {
      logger.warn?.('composer.song.save-conflict', { userId: req.params.userId, id: req.params.id, sentRevision: revision, current: r.current });
      return res.status(409).json({ error: 'revision conflict', current: r.current });
    }
    logger.info?.('composer.song.save', { userId: req.params.userId, id: req.params.id, revision: r.revision, xmlLen: musicxml?.length || 0 });
    res.json(r);
  }));

  router.delete('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const ok = cs.remove(req.params.userId, req.params.id);
    logger.info?.('composer.song.delete', { userId: req.params.userId, id: req.params.id, ok });
    res.json({ ok, id: req.params.id });
  }));

  router.get('/compositions/shared', asyncHandler((req, res) => {
    res.json({ compositions: cs.listShared() });
  }));

  // ── Producer (household pool, author-tagged) ────────────────────────────────
  // Unlike Studio (per-user), the Producer crate is a shared household pool: loops,
  // stacks/sections, and crystallized songs anyone kept, each tagged with the author
  // (current-player userId from the kiosk — trusted from the body per design §6).
  //
  // Ids MUST be dot-free ([a-z0-9-]): FileIO/DataService append `.yml` by inspecting
  // the trailing extension, so a dot in the id would corrupt the filename (MEMORY.md).
  // The same charset also blocks `/`, `\`, `..` and uppercase → no path traversal.
  // Required top-level payload field per family (the "heavy" note/layer/section data).
  const PRODUCER_REQUIRED = { loops: 'notes', crate: 'layers', songs: 'sections' };

  // Light listing projector: identity + kind + author + a small family signature —
  // never the heavy note/layer/section payload (those load on demand via GET :id).
  const producerLight = (family, id, data) => {
    const light = {
      id,
      kind: data.kind ?? null,
      author: data.author ?? null,
      created: data.created ?? null,
      modified: data.modified ?? null,
      revision: data.revision,
      schemaVersion: data.schemaVersion,
      contentHash: data.contentHash,
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
  };

  // Stored records are not repaired on read. Silent normalization made an old
  // or corrupt YAML file look healthy to the client even though the next save,
  // reload, or referenced-loop lookup could fail. Migration is an explicit,
  // backup-first operation; runtime reads therefore fail closed and identify
  // every bad record without hiding the healthy remainder of a household list.
  const hasValidStoredLoop = (loopId) => {
    const loop = ds.getProducer('loops', loopId);
    return !!loop
      && loop.id === loopId
      && validateProducerRecord('loops', loop).length === 0;
  };

  const inspectStoredProducer = (family, id, raw) => {
    const errors = raw && typeof raw === 'object'
      ? validateProducerRecord(family, raw, {
        hasLoop: hasValidStoredLoop,
      })
      : ['record must be an object'];
    if (raw?.id !== id) errors.unshift(`id must match filename: ${id}`);
    return { data: raw, errors };
  };

  const reportStoredProducerError = (family, id, errors) => {
    logger.error?.('piano.producer.stored-invalid', { family, id, errors });
    return { id, errors };
  };

  // Register the CRUD quintet per family in a loop. Because only the three known
  // families get routes, an unknown family (/producer/bogus) falls through to 404.
  for (const family of ['loops', 'crate', 'songs']) {
    const requiredField = PRODUCER_REQUIRED[family];
    const bad = (res, error) => res.status(400).json({ error });

    // GET /producer/{family} → light listing (household pool, no author filter).
    router.get(`/producer/${family}`, asyncHandler((req, res) => {
      const items = [];
      const invalidRecords = [];
      for (const { id, data: raw } of ds.listProducer(family)) {
        const { data, errors } = inspectStoredProducer(family, id, raw);
        if (errors.length) invalidRecords.push(reportStoredProducerError(family, id, errors));
        else items.push(producerLight(family, id, data));
      }
      res.json({ items, invalidRecords });
    }));

    // GET /producer/{family}/:id → full record.
    router.get(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const raw = ds.getProducer(family, req.params.id);
      if (!raw) return res.status(404).json({ error: `${family} record not found` });
      const { data, errors } = inspectStoredProducer(family, req.params.id, raw);
      if (errors.length) {
        reportStoredProducerError(family, req.params.id, errors);
        return res.status(422).json({
          error: 'Stored Producer record is invalid',
          code: 'PRODUCER_RECORD_INVALID',
          id: req.params.id,
          errors,
        });
      }
      res.json(data);
    });

    // POST /producer/{family} → create (server-generated dot-free id).
    router.post(`/producer/${family}`, asyncHandler((req, res) => {
      const payload = (req.body && typeof req.body === 'object') ? req.body : {};
      const author = typeof payload.author === 'string' ? payload.author.trim() : '';
      if (!author) return bad(res, 'author (non-empty string) required');
      if (!Array.isArray(payload[requiredField]) || payload[requiredField].length === 0) {
        return bad(res, `${requiredField} (non-empty array) required`);
      }
      // shortId() draws from a mixed-case charset; producer ids must be dot-free
      // AND match [a-z0-9-], so lowercase it (collision-safe at 10 chars).
      const id = shortId().toLowerCase();
      let data = normalizeProducerRecord(family, {
        ...payload,
        id,
        author,
        created: new Date().toISOString(),
      }, { id });
      const errors = validateProducerRecord(family, data, {
        hasLoop: hasValidStoredLoop,
      });
      if (errors.length) return bad(res, errors.join('; '));
      // Re-saving one captured take or one unchanged crate item is idempotent.
      // Songs are intentionally excluded: Save As must always mint a record.
      if (data.dedupeKey && family !== 'songs') {
        const existing = ds.listProducer(family).find(({ id: candidateId, data: candidate }) => {
          const inspected = inspectStoredProducer(family, candidateId, candidate);
          return inspected.errors.length === 0 && candidate.dedupeKey === data.dedupeKey;
        });
        if (existing) {
          res.set('X-Producer-Deduped', 'true');
          return res.status(200).json(existing.data);
        }
      }
      ds.saveProducer(family, id, data);
      logger.info?.('piano.producer.save', { family, id, author });
      res.status(201).json(data);
    }));

    // PATCH /producer/{family}/:id → partial curate (title/favorite + shallow merge).
    router.patch(`/producer/${family}/:id`, asyncHandler((req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const current = ds.getProducer(family, req.params.id);
      if (!current) return res.status(404).json({ error: `${family} record not found` });
      const currentErrors = inspectStoredProducer(family, req.params.id, current).errors;
      if (currentErrors.length) {
        reportStoredProducerError(family, req.params.id, currentErrors);
        return res.status(422).json({
          error: 'Stored Producer record is invalid',
          code: 'PRODUCER_RECORD_INVALID',
          id: req.params.id,
          errors: currentErrors,
        });
      }
      const patch = (req.body && typeof req.body === 'object') ? req.body : {};
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 1;
      if (patch.expectedRevision != null && patch.expectedRevision !== currentRevision) {
        return res.status(409).json({ error: 'revision conflict', current: currentRevision });
      }
      // Never let a patch rewrite identity/provenance.
      const {
        id: _id, author: _author, created: _created, schemaVersion: _schemaVersion,
        revision: _revision, modified: _modified, contentHash: _contentHash,
        dedupeKey: _dedupeKey, expectedRevision: _expectedRevision, ...mergeable
      } = patch;
      const now = new Date().toISOString();
      const data = normalizeProducerRecord(family, {
        ...current,
        ...mergeable,
        title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title,
        favorite: typeof patch.favorite === 'boolean' ? patch.favorite : current.favorite,
        schemaVersion: PRODUCER_SCHEMA_VERSION,
        revision: currentRevision + 1,
        modified: now,
      }, { id: req.params.id, now });
      const errors = validateProducerRecord(family, data, {
        hasLoop: hasValidStoredLoop,
      });
      if (errors.length) return bad(res, errors.join('; '));
      ds.saveProducer(family, req.params.id, data);
      res.json(data);
    }));

    // DELETE /producer/{family}/:id → { ok, id }.
    router.delete(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const deleted = ds.deleteProducer(family, req.params.id);
      if (!deleted) return res.status(404).json({ error: `${family} record not found` });
      res.json({ ok: true, id: req.params.id });
    });
  }

  // ── Preferences (per-user opaque blob) ──────────────────────────────────────
  router.get('/users/:userId/preferences', (req, res) => {
    const prefs = ds.getPreferences(req.params.userId);
    if (prefs === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(prefs);
  });

  router.put('/users/:userId/preferences', asyncHandler((req, res) => {
    const current = ds.getPreferences(req.params.userId);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const merged = { ...current, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    ds.savePreferences(req.params.userId, merged);
    res.json(merged);
  }));

  // ── Sound preset (per-user opaque blob: { default, favorites }) ────────────
  router.get('/users/:userId/preset', (req, res) => {
    const preset = ds.getPreset(req.params.userId);
    if (preset === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(preset);
  });

  router.put('/users/:userId/preset', asyncHandler((req, res) => {
    const current = ds.getPreset(req.params.userId);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const merged = { ...current, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    ds.savePreset(req.params.userId, merged);
    res.json(merged);
  }));

  // ── Practice history (per-user, per-score sheet-music record) ───────────────
  // scoreKey is a dot-free slug (FileIO appends .yml by sniffing the extension,
  // so a dot would corrupt the filename — same rule as PRODUCER_ID_RE).
  const PRACTICE_KEY_RE = /^[a-z0-9-]{1,120}$/;
  // Bracket-assignment (out[b] = …) invokes inherited setters, so a JSON body
  // carrying an own key literally named "__proto__" (JSON.parse permits this)
  // would swap out's [[Prototype]] instead of storing a bucket — silently
  // wiping existing polish data. Skip the dunder/prototype keys explicitly.
  const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);
  const mergeBuckets = (cur = {}, patch = {}) => {
    const out = { ...cur };
    for (const b of Object.keys(patch)) {
      if (UNSAFE_KEY.has(b)) continue;
      out[b] = { ...(cur?.[b] || {}), ...(patch[b] || {}) };
    }
    return out;
  };

  router.get('/users/:userId/practice/:scoreKey', (req, res) => {
    const { userId, scoreKey } = req.params;
    if (!PRACTICE_KEY_RE.test(scoreKey)) return res.status(400).json({ error: 'Invalid score key' });
    const rec = ds.getPractice(userId, scoreKey);
    if (rec === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(rec);
  });

  router.put('/users/:userId/practice/:scoreKey', asyncHandler((req, res) => {
    const { userId, scoreKey } = req.params;
    if (!PRACTICE_KEY_RE.test(scoreKey)) return res.status(400).json({ error: 'Invalid score key' });
    const current = ds.getPractice(userId, scoreKey);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // A different fingerprint means the score file changed shape — the old
    // per-measure record describes measures that no longer exist. Replace.
    const fpChanged = body.fingerprint && current.fingerprint
      && (typeof body.fingerprint.contentSha256 === 'string'
        ? body.fingerprint.contentSha256 !== current.fingerprint.contentSha256
        : body.fingerprint.measureCount !== current.fingerprint.measureCount
          || body.fingerprint.xmlBytes !== current.fingerprint.xmlBytes);
    const merged = fpChanged
      ? { ...body, updatedAt: new Date().toISOString() }
      : {
        ...current,
        ...body,
        measures: { ...(current.measures || {}), ...(body.measures || {}) },
        polish: mergeBuckets(current.polish, body.polish),
        updatedAt: new Date().toISOString(),
      };
    ds.savePractice(userId, scoreKey, merged);
    logger.info?.('piano.practice.save', { userId, scoreKey });
    res.json(merged);
  }));

  // ── Lesson progress / history (per-user) ────────────────────────────────────
  router.get('/users/:userId/progress', (req, res) => {
    const progress = ds.getProgress(req.params.userId);
    if (progress === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(progress);
  });

  router.put('/users/:userId/progress/:collection/:drillId', asyncHandler((req, res) => {
    const { userId, collection, drillId } = req.params;
    if (!ds.isKnownUser(userId) || !safeSegment(collection) || !safeSegment(drillId)) {
      return res.status(400).json({ error: 'Invalid params' });
    }
    const progress = ds.getProgress(userId) || { collections: {} };
    if (!progress.collections) progress.collections = {};
    const col = progress.collections[collection] || (progress.collections[collection] = {});
    const prev = col[drillId] || {};
    col[drillId] = {
      ...prev,
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      lastPlayed: new Date().toISOString(),
      plays: (prev.plays || 0) + 1,
    };
    ds.saveProgress(userId, progress);
    logger.info?.('piano.progress.record', { userId, collection, drillId });
    res.json(col[drillId]);
  }));

  // ── Lesson drills (content, read-only) ──────────────────────────────────────
  const safeDrillId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

  /**
   * Exercise bank (read-only). The bank stores seeds; instances are computed,
   * never stored, so `/instances` and `/instance` expand on demand rather than
   * reading anything extra off disk.
   *
   *   GET /bank                                   → collections + totals
   *   GET /bank/:collection                       → collection index
   *   GET /bank/:collection/:id                   → one seed
   *   GET /bank/:collection/:id/instances         → instance ids (?limit&expand)
   *   GET /bank/:collection/:id/instance?<axes>   → one materialized instance
   */
  const bankReady = (res) => {
    if (!exerciseBank?.available()) {
      res.status(503).json({ error: 'Exercise bank unavailable' });
      return false;
    }
    return true;
  };

  router.get('/bank', asyncHandler((_req, res) => {
    if (!bankReady(res)) return;
    const index = exerciseBank.getIndex();
    // The manifest is generated; the directory is the truth if they disagree.
    res.json(index || { categories: exerciseBank.listCategories() });
  }));

  // Search must be declared before the catch-all or "search" reads as a path.
  router.get('/bank/catalog', asyncHandler((_req, res) => {
    if (!bankReady(res)) return;
    res.json(buildExerciseCatalog(exerciseBank));
  }));

  router.get('/bank/search', asyncHandler((req, res) => {
    if (!bankReady(res)) return;
    const q = req.query;
    const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    res.json(searchBank(exerciseBank.allSeeds(), {
      mode: typeof q.mode === 'string' ? q.mode : 'free',
      levelMin: number(q.level_min, 1),
      levelMax: number(q.level_max, 10),
      form: typeof q.form === 'string' ? q.form : null,
      collection: typeof q.collection === 'string' ? q.collection : null,
      tradition: typeof q.tradition === 'string' ? q.tradition : null,
      hands: typeof q.hands === 'string' ? q.hands : null,
      tags: typeof q.tags === 'string' ? q.tags.split(',').filter(Boolean) : null,
      limit: Math.min(number(q.limit, 100), 500),
      offset: Math.max(number(q.offset, 0), 0),
    }));
  }));

  /**
   * One catch-all for the tree, because categories nest to any depth and a
   * fixed :collection/:id could not address `drills/hanon/001`. The trailing
   * segment decides what is being asked for.
   */
  router.get('/bank/*splat', asyncHandler((req, res) => {
    if (!bankReady(res)) return;
    // Express 5 hands a named wildcard back as an array of segments.
    const segments = splatPath(req).split('/').filter(Boolean);
    if (!segments.length || segments.some((s) => s === '..' || s.startsWith('_'))) {
      return res.status(400).json({ error: 'Invalid bank path' });
    }

    const last = segments.at(-1);
    const head = segments.slice(0, -1).join('/');

    // …/instance?<axes> and …/instances both address the seed before them.
    if ((last === 'instance' || last === 'instances') && head) {
      const seed = exerciseBank.getSeed(head);
      if (!seed) return res.status(404).json({ error: 'Seed not found' });

      if (last === 'instances') {
        const limit = Math.min(Number(req.query.limit) || 500, 2000);
        if (req.query.expand === 'true') {
          return res.json({ seed_id: seed.id, total: countInstances(seed), instances: expandSeed(seed, { limit }) });
        }
        const ids = instanceIds(seed);
        return res.json({ seed_id: seed.id, total: ids.length, instance_ids: ids.slice(0, limit) });
      }

      const axes = Object.fromEntries(
        Object.entries(req.query).filter(([key]) => key !== 'limit' && key !== 'expand'),
      );
      const instance = materializeById(seed, instanceId(seed.id, axes));
      if (!instance) return res.status(400).json({ error: 'No such instance of this seed', axes });
      return res.json(instance);
    }

    const target = segments.join('/');
    const seed = exerciseBank.getSeed(target);
    if (seed) return res.json({ ...seed, instances: countInstances(seed) });

    const category = exerciseBank.getCategory(target);
    if (category) {
      return res.json({
        ...category,
        seeds: exerciseBank.listSeeds(target),
        categories: exerciseBank.listCategories(target),
      });
    }
    return res.status(404).json({ error: 'Not found in the bank', path: target });
  }));

  router.get('/lessons/:collection', asyncHandler((req, res) => {
    if (!safeSegment(req.params.collection)) return res.status(400).json({ error: 'Invalid collection' });
    const data = ds.getLessonIndex(req.params.collection);
    if (!data) return res.status(404).json({ error: 'Lesson collection not found' });
    res.json(data);
  }));

  router.get('/lessons/:collection/:id', asyncHandler((req, res) => {
    if (!safeSegment(req.params.collection) || !safeDrillId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getLessonDrill(req.params.collection, req.params.id);
    if (!data) return res.status(404).json({ error: 'Drill not found' });
    res.json(data);
  }));

  // ── Course video playable (per-user) ────────────────────────────────────────
  // Per-course roster progress for the poster wall: for each requested course id,
  // returns { isSequential, total, users:[{id,name,completed,total,lastPlayedAt}] }.
  router.get('/courses/progress', asyncHandler(async (req, res) => {
    if (!pianoContainer.isCourseServiceConfigured()) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const { courses } = await pianoContainer.getCourseProgress().execute({ ids });
    res.json({ courses });
  }));

  router.get('/courses/:courseId/playable', asyncHandler(async (req, res) => {
    if (!pianoContainer.isCourseServiceConfigured()) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }
    const outcome = await pianoContainer.getPlayableUnits().execute({
      courseId: req.params.courseId,
      userId: req.query.userId,
    });
    if (!outcome.ok && outcome.reason === 'invalid_user') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    res.json(outcome.result);
  }));

  // ── Menu activity strip: per-player most-recent lesson-course progress ──────
  router.get('/activity/recent', asyncHandler(async (req, res) => {
    if (!pianoContainer.isActivityConfigured()) {
      return res.status(503).json({ error: 'Piano activity service not configured' });
    }
    const result = await pianoContainer.getRecentCourseActivity().execute();
    res.json(result);
  }));

  // ── Always-on MIDI history (.mid per user/date) ─────────────────────────────
  // History lives at the HOUSEHOLD level (not data/users), and accepts `guest`
  // (the dismiss-outcome identity) in addition to known roster users.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TAKE_RE = /^[0-9][0-9.\-]{1,30}$/;            // HH.MM.SS or HH.MM.SS-2
  const historyUser = (u) => u === 'guest' || ds.isKnownUser(u);

  router.put('/users/:userId/history/:date/:takeId', asyncHandler(async (req, res) => {
    const { userId, date, takeId } = req.params;
    if (!historyUser(userId)) return res.status(400).json({ error: 'Invalid user' });
    if (!DATE_RE.test(date) || !TAKE_RE.test(takeId) || takeId.includes('..')) {
      return res.status(400).json({ error: 'Invalid date/take' });
    }
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events (non-empty array) required' });
    }
    const { bytes, path: file } = ds.writeHistoryMidi(userId, date, takeId, events);
    logger.info?.('piano.history.write', { userId, date, takeId, events: events.length, bytes });
    res.json({ ok: true, bytes, path: file });
  }));

  // ── Effect audit (autonomous reverb/chorus audibility test) ────────────────
  // The harness page POSTs each recorded clip as raw audio/webm, then POSTs a
  // manifest. Both land under media/logs/piano/effect-audit/<runId>/ (survives
  // redeploys, like the per-session JSONL logs).
  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // no slashes, no leading dot/dash
  const rawAudio = express.raw({ type: ['audio/webm', 'application/octet-stream'], limit: '25mb' });

  router.post('/effect-audit/:runId/clip/:label', rawAudio, (req, res) => {
    const { runId, label } = req.params;
    if (!SAFE_SEG.test(runId) || !SAFE_SEG.test(label)) {
      return res.status(400).json({ error: 'Invalid runId/label' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty audio body' });
    }
    const { bytes, path: file } = ds.writeEffectAuditClip(runId, label, req.body);
    logger.info?.('piano.effect-audit.clip', { runId, label, bytes });
    res.status(201).json({ ok: true, bytes, path: file });
  });

  router.post('/effect-audit/:runId/manifest', (req, res) => {
    const { runId } = req.params;
    if (!SAFE_SEG.test(runId)) return res.status(400).json({ error: 'Invalid runId' });
    const manifest = req.body;
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.clips)) {
      return res.status(400).json({ error: 'manifest.clips (array) required' });
    }
    const { clips, path: file } = ds.writeEffectAuditManifest(runId, manifest);
    logger.info?.('piano.effect-audit.manifest', { runId, clips });
    res.status(201).json({ ok: true, clips, path: file });
  });

  // Expected errors → { error: "<message>", code }; unexpected 500s → hidden.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createPianoRouter;
