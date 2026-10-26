import { applyCoachEvent, createCoachPlan, coachTaskKey, COACH_VERSION } from '#shared/music/learnCoach.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SCORE = /^[a-z0-9-]{1,120}$/;
const keyOfScore = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
const identity = (state) => JSON.stringify([state?.scoreId, state?.fingerprint]);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export class PianoLearnCoachService {
  #queues = new Map();
  constructor({ datastore, receiptStore, attemptStore, clock, timezone, logger }) {
    if (!datastore || !receiptStore || !attemptStore || typeof clock !== 'function') throw new Error('Coaching persistence requires stores and clock');
    this.datastore = datastore;this.receiptStore = receiptStore;this.attemptStore = attemptStore;
    this.clock = clock;this.timezone = timezone;this.logger = logger;
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
        || (current.mode !== 'free' && (!Number.isFinite(current.tempoPercent) || current.tempoPercent <= 0 || current.tempoPercent > 100))
        || !current.criteria || Object.values(current.criteria).some((n) => !Number.isFinite(n) || n < 0 || n > 1)) fail('Invalid coaching task');
      current = current.parent;
    }
    if (!task) fail('Missing coaching task');
  }
  async record(userId, scoreKey, body) {
    return this.#serial(userId, scoreKey, async () => {
      this.#scope(userId, scoreKey);this.#recover(userId, scoreKey);
      const event = body?.event;
      if (!ID.test(String(event?.id)) || event.profileId !== userId || !['selection', 'outcome'].includes(event.type)) fail('Invalid coaching event');
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
      const state = applyCoachEvent(this.#state(record, plan), { ...event, result }, { plan, now: at.toISOString(), dayKey });
      const acknowledged = { signature, revision: state.revision, fingerprint: plan.fingerprint, scoreId: plan.scoreId };
      this.receiptStore.savePending(userId, scoreKey, { id: event.id, stateAfter: state, receipt: acknowledged });
      this.#recover(userId, scoreKey);
      this.logger?.info?.('piano.learn.saved', { userId, scoreId: plan.scoreId, eventId: event.id, revision: state.revision });
      return this.#response(this.#scope(userId, scoreKey), plan);
    });
  }
}
