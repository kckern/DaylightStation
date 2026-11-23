import { applyCoachEvent, coachSummary, createCoachPlan, coachTaskKey, isGoldWork, projectCoach, COACH_VERSION } from '#shared/music/learnCoach.mjs';
import { resolveSkipMode, stepAccess } from '#shared/music/learnSkipping.mjs';
import { practiceKeyOfScore as keyOfScore } from '../../portable/music/practiceKey.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SCORE = /^[a-z0-9-]{1,120}$/;
const identity = (state) => JSON.stringify([state?.scoreId, state?.fingerprint]);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export class PianoLearnCoachService {
  #queues = new Map();
  /** `skipping` reads the household's `sheetmusic.learn.skipping` policy on each call, so a config reload applies. */
  constructor({ datastore, receiptStore, attemptStore, clock, timezone, logger, pieceLog = null, skipping = null }) {
    if (!datastore || !receiptStore || !attemptStore || typeof clock !== 'function') throw new Error('Coaching persistence requires stores and clock');
    this.datastore = datastore;this.receiptStore = receiptStore;this.attemptStore = attemptStore;
    this.clock = clock;this.timezone = timezone;this.logger = logger;this.pieceLog = pieceLog;
    this.skipping = typeof skipping === 'function' ? skipping : () => skipping;
  }
  /**
   * Notes a chosen or played step that the child's skipping mode locks, judged on the
   * projection before this event. The kiosk enforces the lock; the server records the
   * take anyway and reports it, because the policy can change while a kiosk is open and a
   * refused item would block every later take in the kiosk's save queue. A recovery drill
   * is judged by the step it came from, and a review of a mastered passage is never locked.
   * A task that is no plan step (an old saved tempo) only meets the Silver gate on Gold work.
   */
  #noteLocked({ userId, plan, event, before }) {
    if (event.type !== 'selection' && event.type !== 'outcome') return;
    let root = event.task;
    while (root?.parent) root = root.parent;
    if (root.review) return;
    const segment = before.segments.find((item) => item.id === root.passageId);
    if (!segment) return;
    let mode;
    try { mode = resolveSkipMode({ skipping: this.skipping(), userId, scoreId: plan.scoreId, authored: segment.authoredLadder }); }
    catch { mode = resolveSkipMode({ userId, scoreId: plan.scoreId, authored: segment.authoredLadder }); }
    const key = coachTaskKey(root);
    const step = segment.skills.find((skill) => skill.key === key);
    const open = step ? stepAccess(segment, step, mode) === 'open'
      : mode === 'open' || !isGoldWork(root) || Boolean(segment.certification.silver);
    if (open) return;
    this.logger?.warn?.('piano.learn.coach.locked', { userId, scoreId: plan.scoreId, passageId: segment.id, skill: root.skill ?? null, type: event.type, mode });
  }
  /**
   * The whole piece became all Silver or all Gold because of this one saved take.
   * `before` and `after` share a plan and a legacy record, so legacy credit, a
   * plan edit or a policy change can never be the cause.
   */
  #notePiece({ userId, plan, event, before, after, now }) {
    if (event.type !== 'outcome') return;
    const total = after.piece.total;
    if (!(total > 0)) return;
    // Piece Silver is the whole piece played: the final join (or the one passage of a one-passage piece).
    // Piece Gold is still every passage Gold. Credit an old all-Silver piece earned before joins existed
    // is never paid again: the piece log keeps one entry per level.
    const reached = { silver: after.piece.pieceSilver && !before.piece.pieceSilver,
      gold: after.piece.gold === total && before.piece.gold < before.piece.total };
    for (const level of ['silver', 'gold']) {
      if (!reached[level]) continue;
      this.logger?.info?.('piano.learn.piece-certified', { userId, scoreId: plan.scoreId, level, passages: total });
      this.pieceLog?.note({ userId, scoreId: plan.scoreId, level, passages: total, fingerprint: plan.fingerprint, at: now });
    }
  }
  async #serial(userId, scoreKey, operation) {
    const key = `${userId}/${scoreKey}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.#queues.set(key, next);
    try { return await next; }
    finally { if (this.#queues.get(key) === next) this.#queues.delete(key); }
  }
  #scope(userId, scoreKey) {
    if (!ID.test(String(userId)) || userId === 'guest' || !SCORE.test(String(scoreKey))) fail('Invalid coaching scope');
    const record = this.datastore.getPractice(userId, scoreKey);
    if (record === null) fail('Unknown piano profile');
    return record;
  }
  #state(record, wanted) {
    if (!wanted || identity(record.learnCoach) === identity(wanted)) return record.learnCoach ?? null;
    return record.learnCoachArchive?.[identity(wanted)] ?? null;
  }
  #saveState(userId, scoreKey, state) {
    const record = this.#scope(userId, scoreKey);
    const archive = { ...record.learnCoachArchive };
    if (record.learnCoach && identity(record.learnCoach) !== identity(state)) archive[identity(record.learnCoach)] = record.learnCoach;
    delete archive[identity(state)];
    const save = this.datastore.savePracticeAtomic ?? this.datastore.savePractice;
    if (save.call(this.datastore, userId, scoreKey, { ...record, learnCoach: state, learnCoachArchive: archive }) === false) fail('Could not save piano coaching progress', 503);
  }
  #recover(userId, scoreKey) {
    const pending = this.receiptStore.loadPending(userId, scoreKey);
    if (!pending) return;
    const current = this.#state(this.#scope(userId, scoreKey), pending.stateAfter);
    if (!current || current.revision < pending.stateAfter.revision) this.#saveState(userId, scoreKey, pending.stateAfter);
    this.receiptStore.saveReceipt(userId, scoreKey, pending.id, pending.receipt);
    this.receiptStore.clearPending(userId, scoreKey);
  }
  #response(record, wanted = null, duplicate = false) {
    const state = this.#state(record, wanted);
    return { state, revision: state?.revision ?? 0, duplicate,
      legacy: { fingerprint: record.fingerprint, learn: record.learn, measures: record.measures, polish: record.polish } };
  }
  async get(userId, scoreKey, wanted = null) {
    return this.#serial(userId, scoreKey, () => {
      this.#scope(userId, scoreKey);this.#recover(userId, scoreKey);
      return this.#response(this.#scope(userId, scoreKey), wanted?.fingerprint ? wanted : null);
    });
  }
  #plan(source, scoreKey) {
    if (source?.version !== COACH_VERSION || typeof source.fingerprint !== 'string' || !source.fingerprint.length
      || source.fingerprint.length > 256 || keyOfScore(source.scoreId) !== scoreKey
      || !Array.isArray(source.segments) || source.segments.length > 2000) fail('Invalid coaching plan');
    let plan;
    try { plan = createCoachPlan(source); } catch { fail('Invalid coaching plan'); }
    if (!plan.tasks.length || plan.tasks.some((task) => task.required != null && (!Number.isInteger(task.required) || task.required < 1 || task.required > 1000))) fail('Invalid coaching requirements');
    return plan;
  }
  #task(plan, task) {
    let current = task;let parentCount = 0;
    while (current) {
      const segment = plan.segments.find((item) => item.id === current.passageId);
      if (++parentCount > 3 || !segment || current.scoreId !== plan.scoreId || current.fingerprint !== plan.fingerprint
        || !Number.isInteger(current.range?.start) || !Number.isInteger(current.range?.end)
        || current.range.start < segment.inMeasure || current.range.end > segment.outMeasure || current.range.end < current.range.start
        || !Array.isArray(current.parts) || !current.parts.length || current.parts.some((part) => !segment.playableParts.includes(part))
        || !['free', 'metronome', 'cued'].includes(current.mode)
        || (current.assist != null && current.assist !== 'none')
        || (current.mode !== 'free' && (!Number.isFinite(current.tempoPercent) || current.tempoPercent <= 0 || current.tempoPercent > 100))
        || !current.criteria || Object.values(current.criteria).some((n) => !Number.isFinite(n) || n < 0 || n > 1)) fail('Invalid coaching task');
      current = current.parent;
    }
    if (!task) fail('Missing coaching task');
  }
  #logMastery({ userId, plan, event, before, after, state }) {
    const passageId = event.task.passageId;
    const base = { userId, scoreId: plan.scoreId, passageId };
    if (event.type === 'set-aside') this.logger?.info?.('piano.learn.set-aside', base);
    const entry = state.evidence.at(-1);
    if (event.type === 'outcome' && event.task.assist === 'none' && entry?.id === event.id) {
      this.logger?.info?.('piano.learn.silver-check', { ...base, passed: entry.passedCredits.includes(entry.task.key),
        cleanliness: entry.result.criteria?.cleanliness ?? null });
    }
    for (const segment of after.segments) {
      for (const level of ['silver', 'gold']) {
        const earned = segment.certification[level];
        if (earned && !before.certifications[segment.id]?.[level]) {
          this.logger?.info?.('piano.learn.certified', { userId, scoreId: plan.scoreId, passageId: segment.id, level, provenance: earned.provenance });
        }
      }
    }
  }
  async record(userId, scoreKey, body) {
    return this.#serial(userId, scoreKey, async () => {
      this.#scope(userId, scoreKey);this.#recover(userId, scoreKey);
      const event = body?.event;
      if (!ID.test(String(event?.id)) || event.profileId !== userId || !['selection', 'outcome', 'set-aside'].includes(event.type)) fail('Invalid coaching event');
      const plan = this.#plan(body.plan, scoreKey);
      const signature = JSON.stringify(canonical(body));
      const receipt = this.receiptStore.getReceipt(userId, scoreKey, event.id);
      if (receipt) {
        if (receipt.signature !== signature) fail('Coaching event idempotency conflict', 409);
        return this.#response(this.#scope(userId, scoreKey), plan, true);
      }
      this.#task(plan, event.task);
      let result = null;
      if (event.type === 'outcome') {
        const attempt = await this.attemptStore.get(userId, event.id);
        if (!attempt) fail('Save the assessment before its coaching outcome', 409);
        if (attempt.user_id !== userId || attempt.prompt?.exercise_id !== plan.scoreId
          || !attempt.context?.learnCoachTask || coachTaskKey(attempt.context.learnCoachTask) !== coachTaskKey(event.task)) fail('Assessment does not belong to this coaching task');
        result = { ...attempt, ...(attempt.voided ? { validity: 'invalid' } : {}), inputContractVersion: attempt.context.inputContractVersion };
      }
      const record = this.#scope(userId, scoreKey);
      if (!this.timezone) fail('Household timezone is unavailable; progress was not saved', 503);
      const at = this.clock();
      const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
      const now = at.toISOString();
      const previous = this.#state(record, plan);
      const before = projectCoach({ plan, state: previous, legacy: record, dayKey });
      this.#noteLocked({ userId, plan, event, before });
      const applied = applyCoachEvent(previous, { ...event, result }, { plan, now, dayKey, legacy: record });
      const after = projectCoach({ plan, state: applied, legacy: record, dayKey });
      const state = { ...applied, summary: coachSummary(after, { now, state: applied }) };
      this.#logMastery({ userId, plan, event, before, after, state });
      const acknowledged = { signature, revision: state.revision, fingerprint: plan.fingerprint, scoreId: plan.scoreId };
      this.receiptStore.savePending(userId, scoreKey, { id: event.id, stateAfter: state, receipt: acknowledged });
      this.#recover(userId, scoreKey);
      // Only after the take is durably saved, and never on a replayed receipt.
      this.#notePiece({ userId, plan, event, before, after, now });
      this.logger?.info?.('piano.learn.saved', { userId, scoreId: plan.scoreId, eventId: event.id, revision: state.revision });
      return this.#response(this.#scope(userId, scoreKey), plan);
    });
  }
}
