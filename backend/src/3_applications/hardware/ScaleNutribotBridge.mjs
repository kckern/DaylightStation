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
//
// QUIET COMMIT (`commitQuietMs`): the entry finalises after a LULL, not on first
// sufficiency. Weight, density and container arrive as separate events with no
// payload boundary, so completeness is an absence rather than an event — see
// `armCommit` for the incident that settled it. `scheduler` is injected so the
// lull is testable without fake timers, which interleave badly with the awaited
// AcceptFoodLog call. `commitNowFor` is the one way past the wait — the `rs:done`
// card, which says the sequence is finished.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console, now = () => Date.now(), compositionStore = null,
  commitQuietMs = 25_000, scheduler = { setTimeout, clearTimeout },
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

  // id -> { baseline, lastGrams, live, postTimes[], placed, commitTimer, committedGrams }
  const scales = new Map();
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) {
      s = {
        baseline: null, lastGrams: null, live: null, postTimes: [],
        placed: false, commitTimer: null, committedGrams: null,
      };
      scales.set(id, s);
    }
    return s;
  };

  // Buffer writes are best-effort: a store failure must never break the prompt flow,
  // which works on its own and is what the user is looking at.
  //
  // The relay reports the unit on every frame and the scale really can send `ml`
  // (decode.units maps 0x02 to it). Asserting 'g' here relabelled a volume as a
  // mass, and nothing downstream could refuse what it was never told.
  //
  // `unit` is required, not defaulted — every call site (post, both force/auto
  // edit-in-place branches) already resolves a unit (falling back to 'g' only
  // when the payload itself omitted one, in `onPayload`) before calling this,
  // so a default here would be dead code documenting a contract nothing uses.
  const bufferWeight = (id, grams, unit) => {
    if (!compositionStore) return;
    try { compositionStore.setWeight(id, { grams, unit }); }
    catch (err) { logger.warn?.('scaleNutribot.composition.setWeight.failed', { id, grams, unit, error: err.message }); }
  };
  const bufferEndPlacement = (id) => {
    if (!compositionStore) return;
    try { compositionStore.endPlacement(id); }
    catch (err) { logger.warn?.('scaleNutribot.composition.endPlacement.failed', { id, error: err.message }); }
  };

  // THE QUIET COMMIT. Weight, density and container arrive as separate events
  // with no payload boundary, so "the composition is finished" is not an event
  // anyone sends — it is an absence. Committing the instant weight+density are
  // both present closed the entry 4.4s before the container scan that belonged
  // to it (the 12:31 incident); waiting for a lull catches the whole gesture.
  //
  // Restarted by APPLIED inputs only. Raw scale frames must never restart it,
  // for exactly the reason CompositionStore keeps them out of its own window
  // refresh: the scale heartbeats while it rests on its shelf, so a
  // frame-driven timer would never fire.
  const armCommit = (id, s) => {
    if (!compositionStore || !commitQuietMs) return;
    if (s.commitTimer) scheduler.clearTimeout(s.commitTimer);
    s.commitTimer = scheduler.setTimeout(() => {
      s.commitTimer = null;
      commitNow(id, s).catch((err) =>
        logger.warn?.('scaleNutribot.commit.failed', { id, error: err.message }));
    }, commitQuietMs);
  };

  const disarmCommit = (s) => {
    if (s.commitTimer) { scheduler.clearTimeout(s.commitTimer); s.commitTimer = null; }
  };

  /**
   * Finalise the placement: re-sync the persisted weight, apply the density, accept.
   *
   * @param {string} id scale id
   * @param {object} s per-scale state
   * @param {object|null} [snapshotOverride] composition to commit against, for a
   *   caller that has already consumed the slots — `rs:done` reads the snapshot
   *   BEFORE `endPlacement` wipes it and hands it here, which is the only way
   *   "process it now" can mean anything. Absent, the store is read as usual.
   * @returns {Promise<boolean>} whether an entry was accepted.
   */
  const commitNow = async (id, s, snapshotOverride = null) => {
    if (!s.live) return false;
    let snapshot = snapshotOverride;
    if (!snapshot) {
      if (!compositionStore) return false;
      try { snapshot = compositionStore.read(id); }
      catch (err) { logger.warn?.('scaleNutribot.commit.read-failed', { id, error: err.message }); return false; }
    }
    if (!snapshot?.complete) {
      logger.info?.('scaleNutribot.commit.skipped', { id, reason: 'incomplete' });
      return false;
    }
    // A volume cannot be multiplied by a kcal-per-GRAM density, so a millilitre
    // reading must never finalise itself. This lives HERE and not on
    // `Composition.isComplete`, which is a structural claim about filled slots —
    // the codebase says so in its own tests and reference doc, and quiet-commit
    // is the thing that makes a mislabelled reading dangerous rather than merely
    // wrong. An absent unit is grams (the relay contract).
    const unit = snapshot.unit ?? 'g';
    if (unit !== 'g') {
      logger.warn?.('scaleNutribot.commit.skipped', { id, reason: 'non-gram-unit', unit });
      return false;
    }
    const uc = nutribotContainer.getAcceptFoodLog?.();
    if (!uc) return false;

    // CLAIM the prompt before awaiting, and give it back if the accept fails.
    //
    // `AcceptFoodLog` is awaited, and a scan arriving during that await re-arms
    // the clock. Nulling `s.live` afterwards left the prompt claimable for the
    // whole flight, so a timer that came round again accepted the SAME logUuid
    // twice — a duplicate entry in nutrition history. It needs the accept to
    // outlast the quiet interval, so it is latent rather than everyday, but the
    // claim costs nothing and the duplicate is silent.
    //
    // Restored on failure, because the claim is a loan: a Telegram blip must
    // leave the entry commitable by the next lull rather than stranding it with
    // no way back except answering it by hand.
    const live = s.live;
    s.live = null;

    // APPLY THE DENSITY FIRST — this is where the CALORIES come from.
    //
    // `LogFoodFromScale` persists the item as `{ label: 'Unknown', grams: net,
    // calories: 0 }`, and `AcceptFoodLog` never touches calories. The
    // multiplication lives only in `SelectScaleDensity` — the use case behind the
    // Telegram density button. Committing straight to accept therefore filed a
    // 0 kcal "Unknown" entry AND, by auto-accepting, took away the button that
    // would have computed it: worse than the stranding this feature fixes.
    //
    // Reused rather than reimplemented, so the arithmetic has one home. Note
    // `item0.grams` is ALREADY net — `LogFoodFromScale` applied the container
    // tare at post time — so the tare must not be subtracted a second time.
    const applyDensity = nutribotContainer.getSelectScaleDensity?.();
    if (!applyDensity) {
      s.live = live;
      logger.warn?.('scaleNutribot.commit.skipped', { id, reason: 'no-density-usecase' });
      return false;
    }

    // RE-SYNC the persisted entry against the composition we are about to
    // multiply, BEFORE the density is applied. The commit used to trust whatever
    // grams the last edit happened to persist, and two ordinary things break that:
    //
    //  • a `ct:` scan whose ACK refresh was DROPPED (`refreshPrompt` bails when the
    //    scale is mid-settle) or threw never reached the log, so the tare existed
    //    only in the buffer — and the density then multiplied GROSS grams and filed
    //    silently overcounted calories;
    //  • the human answering the prompt during the quiet window. `editInPlace`
    //    reports `touched: true` the moment `metadata.densityLevel` is set
    //    (`LogFoodFromScale.#isUntouched`), which is exactly "a person already
    //    answered this" — so the commit stands down rather than reverting their
    //    correction to the scanned level and accepting it under their hand.
    //
    // The SAME snapshot the density is resolved from is passed in, so the two
    // cannot disagree, and so the `rs:done` path (whose slots are already consumed)
    // re-syncs against the composition it is committing rather than against nothing.
    let resynced;
    try {
      resynced = await editInPlace(live.grams, id, live, null, live.unit ?? 'g', snapshot);
    } catch (err) {
      s.live = live;
      throw err;
    }
    if (!resynced?.edited) {
      s.live = live;
      logger.info?.('scaleNutribot.commit.skipped', {
        id, reason: resynced?.touched ? 'answered-by-human' : 'resync-failed',
      });
      return false;
    }

    let applied;
    try {
      applied = await applyDensity.execute({
        userId, conversationId, logUuid: live.logUuid,
        level: snapshot.density, messageId: live.messageId,
      });
    } catch (err) {
      s.live = live;
      throw err;
    }
    // A refusal ('unknown level', 'log not found', 'already processed') means the
    // entry has no calories, so accepting it would write exactly the wrong data.
    // Stand down and leave the prompt live — the human can still answer it.
    if (!applied?.success) {
      s.live = live;
      logger.warn?.('scaleNutribot.commit.skipped', {
        id, reason: 'density-failed', level: snapshot.density, error: applied?.error ?? null,
      });
      return false;
    }

    try {
      await uc.execute({ userId, conversationId, logUuid: live.logUuid, messageId: live.messageId });
    } catch (err) {
      s.live = live;
      throw err;
    }

    // CONSUME the slots. A committed placement is over, and `endPlacement` is
    // exactly that statement (D10). Leaving them filled let the next food on the
    // pan inherit this one's density and tare — nudge the plate without lifting
    // it and the new placement posts against the old scans, then auto-accepts
    // 25s later. Quiet-commit is what turns that inheritance from a wrong prompt
    // somebody would notice into a wrong entry nobody does.
    //
    // AFTER the accept and not before, and on no refusal path: an entry that did
    // not commit still needs its scans.
    bufferEndPlacement(id);

    // MARK THE PLACEMENT COMMITTED, or the very next frame re-prompts for it.
    //
    // A commit can only happen with the food still ON the pan — any lift-off
    // disarms the timer — and the relay broadcasts every raw frame at ~4 Hz, not
    // just deduped ones. With `s.live` nulled and nothing recording what was just
    // filed, the next settled frame (~250 ms later) found no live prompt, skipped
    // the dedup guard entirely, cleared `placementDeltaG` and posted a SECOND
    // prompt for the same food. Tapping it filed a second entry: the meal
    // double-counted, silently, on the mainline success path.
    //
    // Cleared on the placed→at-rest crossing (alongside `disarmCommit`) and by
    // `post`, so a genuinely new placement — including a nudge to a different
    // weight, which is a fresh entry and must still prompt — is unaffected.
    s.committedGrams = live.grams;

    logger.info?.('scaleNutribot.commit.committed', {
      id, logUuid: live.logUuid, grams: snapshot.grams, density: snapshot.density,
      container: snapshot.container ?? null,
    });
    return true;
  };

  // Snapshot of what has been scanned for this scale, handed to the use case so the
  // prompt can ACK a tare. Read-only and best-effort: a store failure must not break
  // the prompt, which works on its own.
  const compositionOf = (scaleId) => {
    if (!compositionStore?.read) return null;
    try { return compositionStore.read(scaleId); }
    catch (err) { logger.warn?.('scaleNutribot.composition.read.failed', { scaleId, error: err.message }); return null; }
  };

  const create = (grams, scaleId, unit = 'g') =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit, scaleId,
      composition: compositionOf(scaleId),
    });
  // `notice` is a TRANSIENT, one-shot line for the prompt (e.g. a refused scan).
  // It rides the call and is never stored, so the next render is clean again.
  // `unit` defaults to the live prompt's own unit — the composition-triggered
  // refresh path (refreshPrompt) has no fresh payload to read one from, so the
  // in-place render must carry the same unit the prompt was originally posted with.
  // `composition` likewise defaults to a fresh read, and is passed explicitly only
  // by `commitNow`, which must edit against the SAME snapshot it multiplies —
  // including on the `rs:done` path, where the store has already been consumed and
  // a fresh read would answer "no tare, no density".
  const editInPlace = (
    grams, scaleId, live, notice = null, unit = live.unit ?? 'g',
    composition = compositionOf(scaleId),
  ) =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit, scaleId,
      existingLogUuid: live.logUuid, messageId: live.messageId,
      composition, notice,
    });
  const retract = async (live) => {
    const uc = nutribotContainer.getRetractScaleLog?.();
    if (!uc || !live) return;
    try { await uc.execute({ userId, conversationId, logUuid: live.logUuid, messageId: live.messageId }); }
    catch (err) { logger.warn?.('scaleNutribot.retract.failed', { error: err.message }); }
  };

  // POST a fresh prompt, preserving the single-live invariant (retract any prior live).
  const post = async (id, s, grams, reason, unit = 'g') => {
    if (s.live) { await retract(s.live); s.live = null; }
    const res = await create(grams, id, unit);
    if (res?.success && res.logUuid) {
      s.live = { logUuid: res.logUuid, messageId: res.messageId || null, grams, unit };
      // A fresh prompt supersedes the committed marker: whatever weight was filed
      // before, THIS one is what the pan holds now.
      s.committedGrams = null;
      s.postTimes.push(now());
      bufferWeight(id, grams, unit);
      armCommit(id, s);
      logger.info?.('scaleNutribot.pushed', { id, grams, unit, reason });
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
    // Reported by the relay on every frame; a missing unit stays grams — that is
    // the existing contract and must not change.
    const unit = typeof payload.unit === 'string' && payload.unit ? payload.unit : 'g';
    const s = stateFor(id);

    // FORCE: an ESP button press logs the live weight now, bypassing suspicion.
    if (payload.event === 'button') {
      const g = s.lastGrams;
      if (!Number.isFinite(g) || g <= 0) { logger.warn?.('scaleNutribot.force.noWeight', { id }); return; }
      if (inflight.has(id)) return;
      inflight.add(id);
      try {
        if (s.live && Math.abs(g - s.live.grams) <= forceTolG) {
          const res = await editInPlace(g, id, s.live, null, unit);
          if (res?.edited) { s.live.grams = g; s.live.unit = unit; bufferWeight(id, g, unit); armCommit(id, s); return; }   // already handled → no duplicate
          if (res?.touched) s.live = null;                 // answered → post fresh below
        }
        await post(id, s, g, 'button', unit);
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
        // Disarm on the CROSSING, alongside the buffer consumption it pairs
        // with: `endPlacement` throws the scans away (D10), so a timer still
        // running past this point would commit against a composition that no
        // longer exists. A later scan re-arms it via `armCommitFor`.
        //
        // CROSSING only — `rise <= baselineTolG` is also true on every at-rest
        // heartbeat, and consuming the buffer on those would eat a scan made
        // before the food is set down.
        //
        // The committed marker is released here too: the food came off, so the
        // next thing on the pan is a new placement and deserves its own prompt
        // even if it happens to weigh the same.
        if (s.placed) {
          s.placed = false;
          s.committedGrams = null;
          disarmCommit(s);
          bufferEndPlacement(id);
        }
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
        const res = await editInPlace(grams, id, s.live, null, unit);
        if (res?.edited) { s.live.grams = grams; s.live.unit = unit; bufferWeight(id, grams, unit); armCommit(id, s); return; }  // still unanswered → followed
        if (res?.touched) s.live = null;                    // answered → fall to new placement
        else return;                                        // dispatch failed → bail
      }

      // NEW PLACEMENT.
      //
      // Unless this weight is the one that was JUST committed and never left the
      // pan. The dedup guard above cannot catch it — the commit nulled `s.live`,
      // so there is no live prompt to compare against — and the relay broadcasts
      // every raw frame, so the next settle arrives ~250 ms after the accept.
      // Without this the mainline success path posts a duplicate prompt for food
      // already filed, and answering it double-counts the meal.
      if (Number.isFinite(s.committedGrams) && Math.abs(grams - s.committedGrams) < dedupDeltaG) {
        return;
      }
      if (rise < placementDeltaG) return;   // too small a rise
      const why = suspicious(s, grams, rise);
      if (why) { logger.info?.('scaleNutribot.suppressed', { id, grams, why }); return; }
      await post(id, s, grams, 'auto', unit);
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
    storageWeightG, storageTolG, stormMinPushes, heavyG, forceTolG, commitQuietMs,
    topics: topics || DEFAULT_TOPICS,
  });

  /**
   * Restart the quiet-commit clock for a scale after an APPLIED scan.
   *
   * A `dl:`/`ct:` scan is the other half of the composition and arrives on a
   * different path entirely (`scanDispatch`, not the event bus), so it needs its
   * own way back in. Synchronous and a no-op for a scale that has no state yet —
   * a scan may legitimately precede the placement, and there is nothing to
   * finalise until a weight posts a prompt of its own.
   *
   * @param {string} scaleId
   */
  const armCommitFor = (scaleId) => {
    const s = scales.get(scaleId);
    if (s) armCommit(scaleId, s);
  };

  /**
   * Finalise NOW, without waiting for the lull — the `rs:done` card.
   *
   * "The sequence is complete, process it" is the one gesture that means the wait
   * is over, so arming a 25 s clock for it is not a lesser version of the feature,
   * it is the opposite of what the card says. `rs:done` used to route to
   * `endPlacement` alone, which wiped the slots and left the armed timer to fire
   * later against an empty composition and skip as incomplete: the explicit
   * "process it now" gesture GUARANTEED a stranded entry with no density.
   *
   * The caller supplies the snapshot it read before consuming the slots, because
   * by the time this runs the store has nothing left to read.
   *
   * @param {string} scaleId
   * @param {object|null} [snapshot] composition to commit against
   * @returns {Promise<boolean>} whether an entry was accepted. Never rejects —
   *   this is called fire-and-forget from the scan path, which must not turn a
   *   failed commit into a failed scan.
   */
  const commitNowFor = async (scaleId, snapshot = null) => {
    const s = scales.get(scaleId);
    if (!s) return false;
    // An immediate commit supersedes any pending lull rather than racing it.
    disarmCommit(s);
    try {
      return await commitNow(scaleId, s, snapshot);
    } catch (err) {
      logger.warn?.('scaleNutribot.commit.failed', { id: scaleId, error: err.message });
      return false;
    }
  };

  return {
    refreshPrompt,
    armCommitFor,
    commitNowFor,
    dispose: () => {
      // Disarm FIRST: an unsubscribed bridge that still holds a pending timer
      // would fire into a torn-down container.
      for (const s of scales.values()) disarmCommit(s);
      for (const u of unsubs) { try { u?.(); } catch { /* noop */ } }
    },
  };
}

export default createScaleNutribotBridge;
