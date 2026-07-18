//
// Bridges the food-scale event-bus topic into nutribot with a gated decision flow.
//
// Single-live invariant: at most one UNANSWERED prompt per scale at a time.
//   • AUTO placement — a settled rise above the learned resting baseline posts ONE
//     prompt; further settles EDIT it in place (the prompt follows the weight up).
//     Answering it (detected lazily via LogFoodFromScale's untouched check) frees it, so
//     the next load starts a fresh prompt. Returning near baseline ends the session and
//     RETRACTS an unanswered prompt (cleanup — no leftover slop).
//   • SUSPICION filter — an auto placement is suppressed (logged, not posted) when it
//     looks like putting the scale away: it lands in the known storage-weight band, OR
//     it's a heavy jump right after a storm of recent posts (rolling time window).
//   • FORCE — an ESP button press logs the live weight now, bypassing the suspicion
//     filter. It no-ops when a live unanswered prompt already covers ~this weight, so it
//     never duplicates; otherwise it posts (retracting any stale live first).
//
// Weights NEVER expire. Reported weight is always GROSS. `now` is injected for testable
// window math; session end is event-driven (no wall-clock timers).

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console, now = () => Date.now(),
}) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const baselineTolG = scaleConfig?.baselineToleranceG ?? 6;
  const placementDeltaG = scaleConfig?.placementDeltaG ?? 10;
  const dedupDeltaG = scaleConfig?.dedupDeltaG ?? 5;
  const storageWeightG = scaleConfig?.storageWeightG ?? 0;
  const storageTolG = scaleConfig?.storageToleranceG ?? 15;
  const suspicionWindowMs = (scaleConfig?.suspicionWindowSec ?? 90) * 1000;
  const stormMinPushes = scaleConfig?.stormMinPushes ?? 2;
  const heavyG = scaleConfig?.heavyG ?? 300;
  const forceTolG = scaleConfig?.forceToleranceG ?? 10;

  const scales = new Map();   // id -> { baseline, lastGrams, live, postTimes[] }
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) { s = { baseline: null, lastGrams: null, live: null, postTimes: [] }; scales.set(id, s); }
    return s;
  };

  const create = (grams, scaleId) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', scaleId });
  const editInPlace = (grams, scaleId, live) =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit: 'g', scaleId,
      existingLogUuid: live.logUuid, messageId: live.messageId,
    });
  const retract = async (live) => {
    const uc = nutribotContainer.getRetractScaleLog?.();
    if (!uc || !live) return;
    try { await uc.execute({ userId, conversationId, logUuid: live.logUuid, messageId: live.messageId }); }
    catch (err) { logger.warn?.('scaleNutribot.retract.failed', { error: err.message }); }
  };

  // POST a fresh prompt, preserving the single-live invariant (retract any prior live).
  const post = async (id, s, grams, reason) => {
    if (s.live) { await retract(s.live); s.live = null; }
    const res = await create(grams, id);
    if (res?.success && res.logUuid) {
      s.live = { logUuid: res.logUuid, messageId: res.messageId || null, grams };
      s.postTimes.push(now());
      logger.info?.('scaleNutribot.pushed', { id, grams, reason });
    }
    return res;
  };

  const suspicious = (s, grams, rise) => {
    if (storageWeightG > 0 && Math.abs(grams - storageWeightG) <= storageTolG) return 'storage-band';
    const cutoff = now() - suspicionWindowMs;
    s.postTimes = s.postTimes.filter((t) => t >= cutoff);
    if (s.postTimes.length >= stormMinPushes && rise >= heavyG) return 'jump-after-storm';
    return null;
  };

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const s = stateFor(id);

    // FORCE: an ESP button press logs the live weight now, bypassing suspicion.
    if (payload.event === 'button') {
      const g = s.lastGrams;
      if (!Number.isFinite(g) || g <= 0) { logger.warn?.('scaleNutribot.force.noWeight', { id }); return; }
      if (inflight.has(id)) return;
      inflight.add(id);
      try {
        if (s.live && Math.abs(g - s.live.grams) <= forceTolG) {
          const res = await editInPlace(g, id, s.live);
          if (res?.edited) { s.live.grams = g; return; }   // already handled → no duplicate
          if (res?.touched) s.live = null;                 // answered → post fresh below
        }
        await post(id, s, g, 'button');
      } catch (err) {
        logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message });
      } finally { inflight.delete(id); }
      return;
    }

    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;
    s.lastGrams = grams;                    // track live weight (stable or not) for force
    if (payload.stable !== true) return;    // auto acts only on settled frames
    if (s.baseline === null) { s.baseline = grams; return; } // learn resting load

    const rise = grams - s.baseline;

    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      // SESSION END: back near/below the resting load ⇒ removed / tare / jostle.
      if (rise <= baselineTolG) {
        if (s.live) { await retract(s.live); s.live = null; } // sweep unanswered slop
        s.baseline = grams;
        return;
      }

      if (grams < minGrams) return;         // floor guard

      // LOADING: one live prompt follows the weight (edit in place).
      if (s.live) {
        if (Math.abs(grams - s.live.grams) < dedupDeltaG) return; // same held value
        const res = await editInPlace(grams, id, s.live);
        if (res?.edited) { s.live.grams = grams; return; }  // still unanswered → followed
        if (res?.touched) s.live = null;                    // answered → fall to new placement
        else return;                                        // dispatch failed → bail
      }

      // NEW PLACEMENT.
      if (rise < placementDeltaG) return;   // too small a rise
      const why = suspicious(s, grams, rise);
      if (why) { logger.info?.('scaleNutribot.suppressed', { id, grams, why }); return; }
      await post(id, s, grams, 'auto');
    } catch (err) {
      logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message });
    } finally { inflight.delete(id); }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', {
    conversationId, userId, minGrams, baselineTolG, placementDeltaG, dedupDeltaG,
    storageWeightG, storageTolG, stormMinPushes, heavyG, forceTolG, topics: topics || DEFAULT_TOPICS,
  });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
