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
//
// COMPOSITION BUFFER (optional `compositionStore`): the scale half of scan-enriched
// logging. A weight and a `dl:`/`ct:` scan may arrive in either order, so both write the
// same per-scale buffer and it completes whenever the second one lands.
//   • setWeight fires only where a prompt is POSTED or EDITED — i.e. a qualifying
//     placement. Every settled frame would include the 0.5 Hz at-rest heartbeat, and
//     since setWeight refreshes the store's rolling window the buffer would then never
//     expire (CompositionStore, "The window refresh set EXCLUDES raw scale frames").
//   • endPlacement fires on the placed→at-rest CROSSING, tracked by `s.placed`. It is
//     unconditional in the way that matters — a placement suppressed by the suspicion
//     filter or the min-grams floor still ends, so its scans cannot be inherited by the
//     next food — but it must NOT fire per at-rest frame, or a scan made before the food
//     is set down is consumed within ~2s and scan-first becomes impossible.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console, now = () => Date.now(), compositionStore = null,
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

  const scales = new Map();   // id -> { baseline, lastGrams, live, postTimes[], placed }
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) { s = { baseline: null, lastGrams: null, live: null, postTimes: [], placed: false }; scales.set(id, s); }
    return s;
  };

  // Buffer writes are best-effort: a store failure must never break the prompt flow,
  // which works on its own and is what the user is looking at.
  const bufferWeight = (id, grams) => {
    if (!compositionStore) return;
    try { compositionStore.setWeight(id, { grams, unit: 'g' }); }
    catch (err) { logger.warn?.('scaleNutribot.composition.setWeight.failed', { id, grams, error: err.message }); }
  };
  const bufferEndPlacement = (id) => {
    if (!compositionStore) return;
    try { compositionStore.endPlacement(id); }
    catch (err) { logger.warn?.('scaleNutribot.composition.endPlacement.failed', { id, error: err.message }); }
  };

  // Snapshot of what has been scanned for this scale, handed to the use case so the
  // prompt can ACK a tare. Read-only and best-effort: a store failure must not break
  // the prompt, which works on its own.
  const compositionOf = (scaleId) => {
    if (!compositionStore?.read) return null;
    try { return compositionStore.read(scaleId); }
    catch (err) { logger.warn?.('scaleNutribot.composition.read.failed', { scaleId, error: err.message }); return null; }
  };

  const create = (grams, scaleId) =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit: 'g', scaleId,
      composition: compositionOf(scaleId),
    });
  // `notice` is a TRANSIENT, one-shot line for the prompt (e.g. a refused scan).
  // It rides the call and is never stored, so the next render is clean again.
  const editInPlace = (grams, scaleId, live, notice = null) =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit: 'g', scaleId,
      existingLogUuid: live.logUuid, messageId: live.messageId,
      composition: compositionOf(scaleId), notice,
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
      bufferWeight(id, grams);
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
          if (res?.edited) { s.live.grams = g; bufferWeight(id, g); return; }   // already handled → no duplicate
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
        // DO NOT retract the live prompt here.
        //
        // This used to "sweep unanswered slop" the moment the pan returned to
        // baseline. Observed in production 2026-07-22: a 95 g item posted a
        // prompt at 09:43:04 and it was deleted at 09:43:20 -- sixteen seconds
        // later -- because the item had been lifted off. That is the ordinary
        // way to use a kitchen scale: set it down, read it, pick it up. Under
        // the old rule you had to tap a density while the food was still on the
        // pan or the prompt evaporated, which made the feature unusable.
        //
        // There was never much slop to sweep: a prompt is only posted AFTER the
        // min_grams floor and the suspicion filter, so by construction it
        // already represents a real settled weight worth answering.
        //
        // The single-live invariant is unaffected -- `post()` still retracts any
        // prior live prompt before posting a new one, so weighing a second item
        // supersedes the first exactly as before. The only behaviour change is
        // that a prompt now survives the food being removed.
        //
        // CLOSED, not cleared. The prompt stays answerable but stops being the
        // target of edit-in-place: the LOADING branch below returns early on a
        // live prompt, which would let the NEXT placement hijack this message
        // before the suspicion filter ever ran -- so putting the scale away in
        // its storage band would silently repaint this prompt with the storage
        // weight. Marking it closed sends the next placement down the normal
        // floor/suspicion path, where post() supersedes this one properly.
        if (s.live) s.live.closed = true;
        if (s.placed) { s.placed = false; bufferEndPlacement(id); }
        // CROSSING only — `rise <= baselineTolG` is also true on every at-rest
        // heartbeat, and consuming the buffer on those would eat a scan made
        // before the food is set down.
        if (s.placed) { s.placed = false; bufferEndPlacement(id); }
        s.baseline = grams;
        return;
      }

      // Something is on the scale. Set before the floor/suspicion guards so a
      // placement they suppress still ENDS — otherwise its scans survive and the
      // next food inherits a density and tare that belong to nothing.
      s.placed = true;

      if (grams < minGrams) return;         // floor guard

      // LOADING: one live prompt follows the weight (edit in place). Only a
      // prompt belonging to THIS placement may be followed — a closed one is a
      // past placement still awaiting an answer and must not be repainted.
      if (s.live && !s.live.closed) {
        if (Math.abs(grams - s.live.grams) < dedupDeltaG) return; // same held value
        const res = await editInPlace(grams, id, s.live);
        if (res?.edited) { s.live.grams = grams; bufferWeight(id, grams); return; }  // still unanswered → followed
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

  /**
   * Re-render the live prompt for a scale after its composition changed
   * (a `ct:` or `dl:` scan). No-op when nothing is live — the buffer keeps the
   * selection and the next prompt renders it.
   *
   * `s.live` stays bridge-internal: the scan handler asks for a refresh rather
   * than reaching into the map, so the single-live invariant keeps one owner.
   *
   * Takes the SAME per-scale `inflight` lock as `onPayload`, and DROPS the
   * refresh when the scale is busy rather than queuing behind it. Scanning while
   * the scale settles is the normal interaction, and going straight to
   * `editInPlace` raced: it could edit a message `post()` had just retracted,
   * which Telegram answers with a 400 and the user sees no ACK at all. Dropping
   * loses nothing — the buffer was already written by the time we get here, so
   * the in-flight weight edit reads it and renders the new state anyway. A
   * dropped refresh is expected traffic, not a fault, hence debug.
   *
   * @param {string} scaleId
   * @param {string|null} [notice] one-shot warning line for this render only
   * @returns {Promise<boolean>} whether a live prompt was refreshed
   */
  const refreshPrompt = async (scaleId, notice = null) => {
    const s = scales.get(scaleId);
    if (!s?.live) return false;
    if (inflight.has(scaleId)) {
      logger.debug?.('scaleNutribot.refresh.dropped', { scaleId, reason: 'inflight' });
      return false;
    }
    inflight.add(scaleId);
    try {
      const res = await editInPlace(s.live.grams, scaleId, s.live, notice);
      return Boolean(res?.edited);
    } catch (err) {
      logger.warn?.('scaleNutribot.refresh.failed', { scaleId, error: err.message });
      return false;
    } finally {
      inflight.delete(scaleId);
    }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', {
    conversationId, userId, minGrams, baselineTolG, placementDeltaG, dedupDeltaG,
    storageWeightG, storageTolG, stormMinPushes, heavyG, forceTolG, topics: topics || DEFAULT_TOPICS,
  });

  return { refreshPrompt, dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
