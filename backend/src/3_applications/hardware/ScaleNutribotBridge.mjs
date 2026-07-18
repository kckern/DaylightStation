//
// Bridges the food-scale event-bus topic into nutribot. The relay re-broadcasts the
// full ~4 Hz scale stream (each frame carries a `stable` flag) plus button events.
// Two ways a weight reaches nutribot:
//
//   1) AUTO — every DISTINCT settled value that rises above the scale's learned
//      idle/resting load becomes its own nutribot prompt (a new message per value).
//      The scale never returns to ~0; it rests at a variable load on the shelf, so we
//      learn that resting load as a baseline and only push RISES above it. Re-settles
//      within tolerance are suppressed (jostle); a settle back near/below baseline ends
//      the session (food removed / tare) and re-learns the resting load, so the next
//      placement pushes fresh. Weights NEVER expire — a pushed prompt stays until the
//      user answers it. Known cost: flipping the scale onto its shelf looks like one
//      placement → one stray prompt (just ignore it); it is not repeated.
//
//   2) FORCE — an ESP button press logs the live weight right now, bypassing the
//      baseline/dedup gates entirely. This is the explicit "log this" gesture for when
//      the auto heuristic would miss or mis-gate a real measurement (e.g. a small item,
//      or a load that never rose far above the resting baseline).
//
// Reported weight is always GROSS. Target chat + user are resolved at wiring time
// (household head) and passed in; the bridge itself is device-agnostic.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console,
}) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const baselineTolG = scaleConfig?.baselineToleranceG ?? 6;
  const placementDeltaG = scaleConfig?.placementDeltaG ?? 10;
  const dedupDeltaG = scaleConfig?.dedupDeltaG ?? 5;

  const scales = new Map();   // id -> { baseline:number|null, lastGrams:number|null, lastPushedGrams:number|null }
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) { s = { baseline: null, lastGrams: null, lastPushedGrams: null }; scales.set(id, s); }
    return s;
  };

  const dispatch = (grams, extra) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', ...extra });

  // Push a fresh nutribot prompt (a new message) for this weight. No existingLogUuid
  // ⇒ LogFoodFromScale always creates a new log + Telegram message.
  const push = async (id, grams, reason) => {
    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      const res = await dispatch(grams, { scaleId: id });
      if (res?.success && res.logUuid) {
        stateFor(id).lastPushedGrams = grams;
        logger.info?.('scaleNutribot.pushed', { id, grams, reason });
      }
    } catch (err) {
      logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message });
    } finally {
      inflight.delete(id);
    }
  };

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const s = stateFor(id);

    // FORCE: an ESP button press logs the live weight now, bypassing every gate.
    if (payload.event === 'button') {
      const grams = s.lastGrams;
      if (!Number.isFinite(grams) || grams <= 0) { logger.warn?.('scaleNutribot.force.noWeight', { id }); return; }
      await push(id, grams, 'button');
      return;
    }

    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;
    s.lastGrams = grams;                    // track live weight (stable or not) for force-capture
    if (payload.stable !== true) return;    // AUTO path acts only on settled frames

    // Learn the idle resting load silently (first settled reading).
    if (s.baseline === null) { s.baseline = grams; return; }

    const rise = grams - s.baseline;

    // At/near or below the resting load ⇒ food removed / tare / jostle. Re-learn the
    // resting load and end the session so the next placement pushes fresh.
    if (rise <= baselineTolG) {
      s.baseline = grams;
      s.lastPushedGrams = null;
      return;
    }

    if (grams < minGrams) return;           // floor guard (noise)

    // Loaded. Is this a DISTINCT value that deserves its own message?
    if (s.lastPushedGrams === null) {
      if (rise < placementDeltaG) return;   // too small a rise above rest to be a real placement
    } else if (Math.abs(grams - s.lastPushedGrams) < dedupDeltaG) {
      return;                               // same held value → don't repeat
    }

    await push(id, grams, 'auto');
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, minGrams, baselineTolG, placementDeltaG, dedupDeltaG, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
