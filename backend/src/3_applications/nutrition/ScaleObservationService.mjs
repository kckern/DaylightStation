import { v4 as uuidv4 } from 'uuid';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';
import { ScaleCapture } from './ScaleCapture.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const empty = () => ({ grams: null, unit: null, density: null, container: null, complete: false, active: false, observationIds: [] });

/** Hardware ingress is durable before any awaited processing. Placement IDs,
 * capture IDs, baseline and deadlines survive restart. Quietness closes a batch
 * of evidence, not the food's 72-hour review window. There is no message sender. */
export function createObservationService({ scaleGateway, observationStore: store, nutribotContainer,
  foodLogStore, userId, conversationId = null, scaleConfig = {}, timezone, clock, scheduler,
  commitQuietMs = 25000, logger = {}, newId = uuidv4 }) {
  if (!scaleGateway?.subscribe || !store?.loadPlacements || !foodLogStore || !nutribotContainer?.getFoodLogReview
    || !userId || !clock || !scheduler?.setTimeout) throw new Error('Scale observation service requires durable capture dependencies');
  const capture = new ScaleCapture({ foodLogs: foodLogStore, review: nutribotContainer.getFoodLogReview(),
    config: scaleConfig, userId, conversationId, timezone, clock: { now: () => clock().getTime() }, logger });
  const scales = new Map(Object.entries(store.loadPlacements(userId)));
  const recovering = new Set(scales.keys());
  const timers = new Map();
  const queues = new Map();
  const retryTimers = new Map();
  let disposed = false;
  const now = () => clock().getTime();
  const persist = id => store.savePlacement(userId, id, scales.get(id));
  const stateFor = id => {
    if (!scales.has(id)) scales.set(id, { baseline: null, lastGrams: null, placed: false, placement: null, postTimes: [] });
    return scales.get(id);
  };
  const recordsFor = placement => store.findByPlacement(userId, placement.id).filter(row => row.status !== 'dismissed');
  const snapshotFor = placement => {
    if (!placement || placement.cancelled) return empty();
    const records = recordsFor(placement);
    // Use evidence's own time on recovery. A restart cannot age an already
    // complete placement out of existence before its saved intent is projected.
    const latest = Math.max(Date.parse(placement.startedAt), ...records.map(row => Date.parse(row.observedAt)));
    const rows = records.filter(row => latest - Date.parse(row.observedAt) <= WINDOW_MS);
    const snapshot = empty();
    for (const row of rows) {
      if (row.kind === 'weight') { snapshot.grams = row.value; snapshot.unit = row.unit || 'g'; }
      if (row.kind === 'density') snapshot.density = row.value;
      if (row.kind === 'container') snapshot.container = row.value;
      snapshot.observationIds.push(row.id);
    }
    snapshot.lastInputAt = new Date(latest).toISOString();
    snapshot.complete = snapshot.grams > 0 && snapshot.density != null;
    snapshot.active = rows.length > 0;
    return snapshot;
  };
  const read = id => snapshotFor(stateFor(id).placement);
  const enqueue = (id, action) => {
    const previous = queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(id, next);
    // Keep the rejection visible to awaited callers, while fire-and-forget
    // hardware delivery gets a structured failure instead of an unhandled one.
    next.catch(error => {
      logger.warn?.('nutrition.scale.reconcile_failed', { scaleId: id, error: error.message });
      if (!disposed && !retryTimers.has(id)) retryTimers.set(id, scheduler.setTimeout(() => {
        retryTimers.delete(id);
        void enqueue(id, action);
      }, 30000));
    });
    return next;
  };
  const reconcile = async (id, placement, closeBatch = false) => {
    if (disposed) return false;
    if (placement.cancelled) { await capture.discard(placement); return false; }
    const snapshot = snapshotFor(placement);
    const result = await capture.reconcile(placement, snapshot);
    if (result.success && result.complete) {
      // Consumption only follows a successful ledger write. Every retry has the
      // same capture ID even if the process died between these two stores.
      const patches = snapshot.observationIds.map(obsId => ({ id: obsId, status: 'consumed', pairedEntryUuid: result.entryUuid }));
      if (patches.length) store.updateMany(userId, patches);
      placement.counted = true;
    }
    if (closeBatch) placement.quietAt = new Date(now()).toISOString();
    persist(id);
    logger.info?.('nutrition.scale.reconciled', { scaleId: id, placementId: placement.id,
      complete: result.complete || false, reason: result.reason || null, closeBatch });
    return result.success;
  };
  const disarm = id => { if (timers.has(id)) scheduler.clearTimeout(timers.get(id)); timers.delete(id); };
  const arm = (id, placement) => {
    disarm(id);
    const snapshot = snapshotFor(placement);
    const delay = Math.max(0, Date.parse(snapshot.lastInputAt || placement.startedAt) + commitQuietMs - now());
    timers.set(id, scheduler.setTimeout(() => {
      timers.delete(id);
      void enqueue(id, () => reconcile(id, placement, true));
    }, delay));
  };
  const newPlacement = id => {
    const s = stateFor(id);
    if (s.placement) {
      const previous = s.placement;
      previous.closedAt ||= new Date(now()).toISOString();
      s.previousPlacements = [...(s.previousPlacements || []).filter(p => !p.counted), previous];
      void enqueue(id, () => reconcile(id, previous));
    }
    const placement = { id: newId(), scaleId: id, startedAt: new Date(now()).toISOString() };
    s.placement = placement;
    persist(id); // identity precedes the observation, and any ledger append
    logger.info?.('nutrition.scale.placement_started', { scaleId: id, placementId: placement.id });
    return placement;
  };
  const append = (id, kind, value, unit = null) => {
    let placement = stateFor(id).placement;
    if (!placement || placement.cancelled || now() - Date.parse(snapshotFor(placement).lastInputAt || placement.startedAt) > WINDOW_MS) placement = newPlacement(id);
    const record = store.append(userId, { kind, value, unit, scaleId: id, placementId: placement.id,
      observedAt: new Date(now()).toISOString(), at: formatLocalTimestamp(clock(), timezone) });
    placement.lastObservationId = record.id;
    placement.quietAt = null;
    persist(id);
    arm(id, placement);
    void enqueue(id, () => reconcile(id, placement));
    logger.info?.('observation.appended', { scaleId: id, placementId: placement.id, id: record.id, kind, value, unit });
    return read(id);
  };
  const setWeight = (id, payload) => append(id, 'weight', payload.grams, payload.unit || 'g');
  const setDensity = (id, level) => append(id, 'density', level);
  const setContainer = (id, container) => append(id, 'container', container);
  const endPlacement = id => {
    const s = stateFor(id);
    if (!s.placement) return false;
    s.placed = false;
    s.placement.closedAt = new Date(now()).toISOString();
    persist(id);
    disarm(id);
    const placement = s.placement;
    void enqueue(id, () => reconcile(id, placement, true));
    logger.info?.('nutrition.scale.placement_ended', { scaleId: id, placementId: placement.id, reason: 'removed-or-done' });
    return true;
  };
  const clear = id => {
    const s = stateFor(id);
    const p = s.placement;
    if (!p || p.cancelled) return false;
    p.cancelled = true;
    s.suppressUntilRemoved = true;
    store.updateMany(userId, recordsFor(p).map(row => ({ id: row.id, status: 'dismissed', pairedEntryUuid: null })));
    disarm(id); persist(id);
    void enqueue(id, () => reconcile(id, p));
    return true;
  };
  const undo = id => {
    const p = stateFor(id).placement;
    if (!p?.lastObservationId || p.cancelled) return false;
    store.update(userId, p.lastObservationId, { status: 'dismissed', pairedEntryUuid: null });
    p.lastObservationId = null;
    persist(id); arm(id, p);
    void enqueue(id, () => reconcile(id, p));
    return true;
  };
  const onPayload = async payload => {
    if (!payload || typeof payload !== 'object' || disposed) return;
    const id = payload.id || 'unknown';
    const s = stateFor(id);
    if (payload.event === 'button') {
      if (!(s.lastGrams > 0)) return;
      s.suppressUntilRemoved = false;
      const snap = read(id);
      if (Math.abs((snap.grams || 0) - s.lastGrams) < (scaleConfig.forceToleranceG ?? 10)) return;
      setWeight(id, { grams: s.lastGrams, unit: payload.unit || 'g' });
      await queues.get(id); return;
    }
    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;
    s.lastGrams = grams;
    if (payload.stable !== true) return;
    if (s.baseline === null) { s.baseline = grams; persist(id); return; }
    const rise = grams - s.baseline;
    if (rise <= (scaleConfig.baselineToleranceG ?? 6)) {
      recovering.delete(id);
      if (s.suppressUntilRemoved) { s.suppressUntilRemoved = false; persist(id); }
      if (s.placed) endPlacement(id);
      if (s.baseline !== grams) { s.baseline = grams; persist(id); }
      await queues.get(id); return;
    }
    if (s.suppressUntilRemoved) return;
    if (recovering.delete(id) && s.placed && Math.abs(grams - (read(id).grams || 0)) >= (scaleConfig.dedupDeltaG ?? 5)) {
      // We did not observe the load change while offline. Keep the old food,
      // start fresh evidence, and never lend its density/tare to an unknown load.
      endPlacement(id);
      logger.info?.('nutrition.scale.recovered_load_changed', { scaleId: id, grams });
    }
    if (grams < (scaleConfig.minGrams ?? 5) || rise < (scaleConfig.placementDeltaG ?? 10)) return;
    const storage = scaleConfig.storageWeightG ?? 0;
    if (storage > 0 && Math.abs(grams - storage) <= (scaleConfig.storageToleranceG ?? 15)) {
      logger.info?.('scaleNutribot.suppressed', { id, grams, why: 'storage-band' }); return;
    }
    if (!s.placed) {
      s.postTimes = (s.postTimes || []).filter(at => at >= now() - (scaleConfig.suspicionWindowSec ?? 90) * 1000);
      if (s.postTimes.length >= (scaleConfig.stormMinPushes ?? 2) && rise >= (scaleConfig.heavyG ?? 300)) {
        logger.info?.('scaleNutribot.suppressed', { id, grams, why: 'jump-after-storm' }); return;
      }
      // Scans made before a weight own the upcoming placement. A prior weighed
      // placement never donates its tare/density to a new physical placement.
      if (s.placement && read(id).grams != null) newPlacement(id);
      s.placed = true;
      s.postTimes.push(now());
      persist(id);
    }
    const snap = read(id);
    const unit = payload.unit || 'g';
    if (snap.grams != null && Math.abs(grams - snap.grams) < (scaleConfig.dedupDeltaG ?? 5) && snap.unit === unit) return;
    setWeight(id, { grams, unit });
    await queues.get(id);
  };
  const refreshPrompt = id => {
    const p = stateFor(id).placement;
    return p ? enqueue(id, () => reconcile(id, p)) : Promise.resolve(false);
  };
  const commitNowFor = id => {
    disarm(id);
    const p = stateFor(id).placement;
    return p ? enqueue(id, () => reconcile(id, p, true)) : Promise.resolve(false);
  };
  const unsubscribe = scaleGateway.subscribe(onPayload);
  const recovery = [];
  for (const [id, s] of scales) {
    for (const previous of s.previousPlacements || []) recovery.push(enqueue(id, () => reconcile(id, previous)));
    if (!s.placement) continue;
    const p = s.placement;
    recovery.push(enqueue(id, () => reconcile(id, p)));
    if (!p.cancelled && !p.quietAt) arm(id, p);
  }
  logger.info?.('observation.service.ready', { userId, scales: scales.size, mode: 'provisional-ledger' });
  const ready = Promise.all(recovery);
  ready.catch(error => logger.warn?.('nutrition.scale.recovery_failed', { userId, error: error.message }));
  return { setWeight, setDensity, setContainer, read, clear, undo, endPlacement,
    refreshPrompt, commitNowFor, armCommitFor: id => { const p = stateFor(id).placement; if (p && !p.cancelled) arm(id, p); },
    ready,
    settled: async () => { await Promise.all([...queues.values()]); },
    dispose: () => { disposed = true; for (const id of timers.keys()) disarm(id);
      for (const timer of retryTimers.values()) scheduler.clearTimeout(timer); retryTimers.clear(); unsubscribe?.(); } };
}
