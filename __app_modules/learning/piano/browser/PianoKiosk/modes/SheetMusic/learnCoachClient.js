import { applyCoachEvent, createCoachPlan } from '../../../../../../../shared/music/learnCoach.mjs';
import { buildPianoAttemptEvidence } from '../../../performance/attemptEvidence.js';

const OUTBOX = 'piano.learn.coach.outbox.v1';
const LIMIT = 128;
export const coachScopeKey = (scope) => JSON.stringify([scope.profileId, scope.scoreId, scope.fingerprint]);
const persistent = (scope) => Boolean(scope.profileId && scope.profileId !== 'guest');

/** Store the plan recipe once per scope, not duplicate task projections. */
export function serializeCoachPlan(plan) {
  return { version: plan.version, scoreId: plan.scoreId, fingerprint: plan.fingerprint,
    authoredLadder: plan.authoredLadder, tempoMap: plan.tempoMap, criteria: plan.criteria,
    segments: plan.segments.map((segment) => ({ id: segment.id, inMeasure: segment.inMeasure, outMeasure: segment.outMeasure,
      printedMeasures: segment.printedMeasures, playableParts: segment.playableParts, label: segment.label,
      name: segment.name, authoredLadder: segment.authoredLadder,
      ...((plan.authoredLadder || segment.authoredLadder) ? { ladder: segment.ladder } : {}) })),
  };
}

/** Ordered assessment -> coaching writes with durable, profile-scoped retry. */
export function createLearnCoachClient({ request, storage = null, onChange = () => {}, now = () => new Date(), dayKey, logger } = {}) {
  if (typeof request !== 'function') throw new Error('Coaching needs a request transport');
  const entries = new Map();let disposed = false;let storageError = null;
  const context = () => { const at = now();const iso = typeof at === 'string' ? at : at.toISOString();return { now: iso, dayKey: dayKey?.() ?? iso.slice(0, 10) }; };
  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(OUTBOX) ?? '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved progress queue has an unreadable format');
      return parsed;
    }
    catch (error) { storageError = error.message;return {}; }
  };
  const ensure = (scope, plan) => {
    const key = coachScopeKey(scope);
    if (!entries.has(key)) {
      const held = persistent(scope) ? read()[key] : null;
      entries.set(key, { scope: { ...scope }, plan: plan ?? (held?.plan ? createCoachPlan(held.plan) : null),
        items: held?.items ?? [], acknowledged: new Set(), serverState: null, legacy: {}, loaded: !persistent(scope), error: null, running: null });
    }
    const entry = entries.get(key);if (plan) entry.plan = plan;return entry;
  };
  const snapshot = (entry) => {
    const state = entry.plan ? entry.items.reduce((current, item) => applyCoachEvent(current, item.body.event, { plan: entry.plan, ...context() }), entry.serverState) : entry.serverState;
    return { scope: entry.scope, state, legacy: entry.legacy, loaded: entry.loaded,
      revision: entry.serverState?.revision ?? 0, pendingCount: entry.items.length, storageError,
      error: entry.error, saveStatus: !persistent(entry.scope) ? 'guest' : entry.error ? 'error' : entry.items.length ? 'pending' : entry.loaded ? 'saved' : 'loading' };
  };
  const emit = (entry) => { if (!disposed) onChange(entry.scope, snapshot(entry)); };
  const persist = (entry) => {
    if (!persistent(entry.scope)) return;
    try {
      if (!storage) throw new Error('Browser storage is unavailable');
      const data = read();const key = coachScopeKey(entry.scope);
      const merged = new Map((data[key]?.items ?? []).map((item) => [item.body.event.id, item]));
      for (const item of entry.items) merged.set(item.body.event.id, item);
      for (const id of entry.acknowledged) merged.delete(id);
      entry.items = [...merged.values()];
      if (entry.items.length) data[key] = { scope: entry.scope, plan: serializeCoachPlan(entry.plan), items: entry.items };
      else delete data[key];
      storage.setItem(OUTBOX, JSON.stringify(data));
    } catch (error) { storageError = error.message; }
  };
  const url = (scope) => `api/v1/piano/users/${encodeURIComponent(scope.profileId)}/practice/${encodeURIComponent(scope.scoreKey)}/coach`;
  const accept = (entry, response) => {
    if ((response?.revision ?? 0) >= (entry.serverState?.revision ?? 0)) {
      entry.serverState = response?.state ?? null;
      entry.legacy = response?.legacy ?? entry.legacy;
    }
    entry.loaded = true;
  };
  const drain = (entry) => {
    if (entry.running) return entry.running;
    if (disposed || !persistent(entry.scope) || !entry.items.length) return Promise.resolve(snapshot(entry));
    entry.running = (async () => {
      entry.error = null;emit(entry);
      try {
        while (entry.items.length && !disposed) {
          const item = entry.items[0];
          if (item.evidence && !item.assessmentSaved) {
            await request(`api/v1/piano/users/${encodeURIComponent(entry.scope.profileId)}/attempts`, { method: 'POST', body: item.evidence });
            item.assessmentSaved = true;persist(entry);
            if (disposed) break;
          }
          const response = await request(url(entry.scope), { method: 'POST', body: item.body });
          accept(entry, response);
          entry.acknowledged.add(item.body.event.id);
          entry.items = entry.items.filter((pending) => pending.body.event.id !== item.body.event.id);
          persist(entry);
          logger?.info?.('piano.learn.save-ack', { learnerId: entry.scope.profileId, eventId: item.body.event.id, revision: response.revision });
          emit(entry);
        }
      } catch (error) {
        entry.error = error.message;
        logger?.warn?.('piano.learn.save-failed', { learnerId: entry.scope.profileId, scoreId: entry.scope.scoreId, error: error.message });
      } finally { entry.running = null;emit(entry); }
      return snapshot(entry);
    })();
    return entry.running;
  };
  return {
    get: (scope) => snapshot(ensure(scope)),
    async load(scope, plan) {
      // React may replay effect setup after cleanup using the same client.
      disposed = false;
      const entry = ensure(scope, plan);
      if (!persistent(scope)) { emit(entry);return snapshot(entry); }
      try {
        const query = new URLSearchParams({ scoreId: scope.scoreId, fingerprint: scope.fingerprint });
        accept(entry, await request(`${url(scope)}?${query}`, { method: 'GET' }));entry.error = null;
      } catch (error) { entry.loaded = true;entry.error = error.message; }
      emit(entry);await drain(entry);return snapshot(entry);
    },
    async enqueue(scope, event, plan) {
      const entry = ensure(scope, plan);
      const captured = structuredClone({ ...event, profileId: scope.profileId });
      if (!persistent(scope)) {
        entry.serverState = applyCoachEvent(entry.serverState, captured, { plan, ...context() });entry.loaded = true;emit(entry);return snapshot(entry);
      }
      if (!entry.items.some((item) => item.body.event.id === captured.id)) {
        const storedCount = Object.entries(read()).filter(([key]) => key !== coachScopeKey(scope)).reduce((n, [, value]) => n + (value.items?.length ?? 0), 0);
        if (storedCount + entry.items.length >= LIMIT) { entry.error = 'Progress queue is full';emit(entry);throw new Error(entry.error); }
        const item = { body: { event: captured, plan: serializeCoachPlan(plan) }, assessmentSaved: false };
        if (captured.type === 'outcome') {
          const { assessmentId: ignoredId, ...result } = captured.result;void ignoredId;
          item.evidence = buildPianoAttemptEvidence({ result, attemptId: captured.id,
            activityId: `learn:${scope.scoreId}:${captured.task.skill}`, kind: 'score', purpose: 'practice',
            prompt: { exercise_id: scope.scoreId, mode: captured.task.mode, label: captured.task.label },
            context: { surface: 'sheet-music-learn', matcher: captured.task.mode === 'cued' ? 'timed' : 'cursor',
              mode: captured.task.mode, inputContractVersion: 'onsets-v1', learnCoachTask: captured.task,
              program_id: `learn:${captured.task.passageId}:${captured.task.skill}` }, providerVersion: 'exercise-runtime-v5-onsets' });
        }
        entry.items.push(item);persist(entry);
      }
      entry.error = null;emit(entry);return drain(entry);
    },
    async retry(scope) {
      const entry = ensure(scope);entry.error = null;
      if (!entry.items.length) return this.load(scope, entry.plan);
      return drain(entry);
    },
    dispose() { disposed = true; },
  };
}
