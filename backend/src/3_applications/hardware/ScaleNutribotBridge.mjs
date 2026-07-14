//
// Bridges the food-scale event-bus topic into nutribot. The relay re-broadcasts the
// FULL ~4 Hz stream (each frame carries a `stable` flag); the bridge only acts on
// stable frames.
//
// The scale never returns to ~0 — it rests at a variable baseline load on the shelf.
// So this bridge learns a per-scale resting baseline (the first stable reading, then
// tracked while idle) and only prompts when the weight RISES ≥ placementDelta above
// it. Re-settles within tolerance of the baseline are suppressed (shelf jostle), and
// while a prompt is active a further rise ≥ editDelta edits it in place. Unanswered
// prompts auto-expire (via ExpireScaleLog) and the expired weight becomes the new
// baseline; prompts the user engaged with before expiry are "committed" and only
// clear on removal (return to baseline). Reported weight is always GROSS — the
// baseline is a gate only, never subtracted.
//
// Target chat + user are resolved at wiring time (household head) and passed in; the
// bridge itself is device-agnostic.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
}) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const baselineTolG = scaleConfig?.baselineToleranceG ?? 6;
  const placementDeltaG = scaleConfig?.placementDeltaG ?? 10;
  const editDeltaG = scaleConfig?.editDeltaG ?? 3;
  const expireMs = scaleConfig?.expireMs ?? 180000;

  const scales = new Map();   // id -> { baseline:number|null, active:{logUuid,messageId,lastGrams,committed,timer}|null }
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) { s = { baseline: null, active: null }; scales.set(id, s); }
    return s;
  };

  const dispatch = (grams, extra) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', ...extra });

  const clearActive = (s) => {
    if (s.active?.timer) clearTimeoutFn(s.active.timer);
    s.active = null;
  };

  const onExpire = async (id, s) => {
    const cur = s.active;
    if (!cur) return;
    try {
      const res = await nutribotContainer.getExpireScaleLog?.().execute({
        userId, conversationId, logUuid: cur.logUuid, messageId: cur.messageId,
      });
      if (s.active !== cur) return; // state moved on while awaiting
      if (res?.expired) {
        s.baseline = cur.lastGrams;   // phantom's weight becomes the new resting load
        clearActive(s);
        logger.info?.('scaleNutribot.expired', { id, grams: cur.lastGrams });
      } else {
        cur.committed = true;         // user engaged — stop editing/expiring, keep for removal
        if (cur.timer) clearTimeoutFn(cur.timer);
        cur.timer = null;
      }
    } catch (err) {
      logger.warn?.('scaleNutribot.expire.failed', { id, error: err.message });
    }
  };

  const armExpire = (id, s) => {
    if (!s.active) return;
    if (s.active.timer) clearTimeoutFn(s.active.timer);
    const t = setTimeoutFn(() => { void onExpire(id, s); }, expireMs);
    if (t && typeof t.unref === 'function') t.unref();
    s.active.timer = t;
  };

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;
    if (payload.stable !== true) return; // only act on stable readings (ignore wobble)

    const s = stateFor(id);
    if (s.baseline === null) { s.baseline = grams; return; } // learn resting weight silently

    const rise = grams - s.baseline;
    const atRest = Math.abs(rise) <= baselineTolG;

    if (s.active) {
      if (atRest) { s.baseline = grams; clearActive(s); return; } // food removed → re-arm
      if (s.active.committed) return;                              // user owns it; wait for removal
      if (Math.abs(grams - s.active.lastGrams) >= editDeltaG) {
        if (inflight.has(id)) return;
        inflight.add(id);
        try {
          const res = await dispatch(grams, { scaleId: id, existingLogUuid: s.active.logUuid, messageId: s.active.messageId });
          if (s.active) {
            if (res?.success && res.messageId) s.active.messageId = res.messageId;
            s.active.lastGrams = grams;
            armExpire(id, s);
          }
        } catch (err) { logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message }); }
        finally { inflight.delete(id); }
      }
      return;
    }

    // No active prompt.
    if (atRest || rise < 0) { s.baseline = grams; return; } // at/below rest → track baseline (tare / lighter surface)
    if (rise < placementDeltaG) return;                     // small unexplained bump → ignore

    if (inflight.has(id)) return; // deliberate placement
    inflight.add(id);
    try {
      const res = await dispatch(grams, { scaleId: id });
      if (res?.success && res.logUuid) {
        s.active = { logUuid: res.logUuid, messageId: res.messageId || null, lastGrams: grams, committed: false, timer: null };
        armExpire(id, s);
      }
    } catch (err) { logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message }); }
    finally { inflight.delete(id); }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, baselineTolG, placementDeltaG, editDeltaG, expireMs, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const s of scales.values()) clearActive(s); for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
