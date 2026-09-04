// backend/src/3_applications/nutrition/ObservationService.mjs
//
// THE DURABLE REPLACEMENT FOR `ScaleNutribotBridge` + `CompositionStore`.
//
// The kitchen scale half of scan-enriched food logging, rebuilt on a durable ledger.
// Everything the shipped bridge did is here — the gated prompt flow, the quiet commit,
// the control verbs, slot consumption, re-prompt dedup, the non-gram refusal — with one
// structural change: the in-progress composition is no longer a
// `Map<scaleId, {composition, touchedAt}>` that dies with the process. Every signal is
// APPENDED to an `IObservationStore` row and the composition is RECOMPUTED from those
// rows on every read, by the pure `matchObservations` rules.
//
// That is the whole point of the phase. Under the old design a backend restart silently
// lost the buffer and the bridge relearned whatever was on the pan as its baseline, so
// food already sitting on the scale never posted and a density scanned thirty seconds
// before the deploy simply evaporated (`docs/reference/nutrition/README.md`, "Known gaps
// — Backend restart loses the buffer"). A fresh service constructed over the same store
// contents now recovers the in-progress composition exactly, because the state is on
// disk rather than in a closure.
//
// ## Behaviour inherited from the bridge, deliberately and completely
//
// This is a port, not a redesign. Every rule below was learned from a real failure in a
// real kitchen and is reproduced here with the incident intact:
//
//   • SINGLE LIVE PROMPT per scale. A settled rise above the learned resting baseline
//     posts ONE prompt; further settles EDIT it in place. Answering it frees it.
//   • SESSION END does NOT retract an unanswered prompt — it CLOSES it. Retracting was
//     observed deleting a 95 g prompt sixteen seconds after posting it, because the food
//     had been picked up, which is the ordinary way to use a kitchen scale.
//   • SUSPICION filter — a placement in the storage-weight band, or a heavy jump right
//     after a storm of posts, is suppressed (logged, not posted): that is the scale being
//     put away, not food.
//   • FORCE (ESP button) logs the live weight now, bypassing suspicion, and no-ops when a
//     live prompt already covers ~this weight.
//   • QUIET COMMIT after a lull, not on first sufficiency. Weight, density and container
//     arrive as separate events with no payload boundary, so "the composition is
//     finished" is an ABSENCE, not an event. Committing the instant weight+density were
//     both present closed the entry 4.4 s before the container scan that belonged to it.
//   • RE-PROMPT DEDUP. A commit happens with the food still on the pan and the relay
//     broadcasts at ~4 Hz, so the next settle lands ~250 ms after the accept. Without the
//     committed-weight marker every successful commit posted a SECOND prompt for food
//     already filed, and answering it double-counted the meal.
//   • SLOT CONSUMPTION at placement end, unconditional in the way that matters — a
//     placement suppressed by the floor or the suspicion filter still ENDS, or the next
//     food inherits a density and a tare that belong to nothing.
//   • NON-GRAM REFUSAL at commit time. A millilitre reading cannot be multiplied by a
//     kcal-per-GRAM density, and quiet-commit is what turns a mislabelled reading from
//     merely wrong into silently filed.
//
// ## Where the non-gram refusal lives, and why it is here TOO
//
// `ObservationMatcher.isPlausibleWeightPairing` already refuses to PAIR a non-gram weight
// observation to an existing entry. That is a different question from the one this file
// asks, and the two do not contradict each other:
//
//   matcher  — "may this weight attach itself to an entry that already exists?"
//   service  — "may this composition finalise itself into a NEW entry, unattended?"
//
// The shipped bridge enforced it at commit time and this service keeps it there, under
// the SAME log event (`scaleNutribot.commit.skipped`, `reason: 'non-gram-unit'`), because
// the commit path is the only place where a mislabelled unit becomes a wrong number in
// history with nobody watching. Deliberately NOT hoisted onto "is the composition
// complete", which stays a structural claim about which slots are filled — the same split
// the codebase's own reference doc describes.
//
// ## Composition semantics, expressed in observation rows
//
// `CompositionStore` had three overwritable SLOTS. Here every signal is an append-only
// row and `matchObservations` merges the still-`open`, still-in-window rows for one scale
// into the same snapshot shape, last-writer-wins per slot. That falls out correctly:
//
//   • rescanning `dl:7` over `dl:4` leaves both rows open, and the later one wins;
//   • `rs:undo` DISMISSES the most recently appended row, so the one it superseded wins
//     again — which is exactly `CompositionStore`'s "restore the previous value";
//   • undo is still ONE DEEP: the id is consumed by the undo that used it, so a second
//     consecutive `rs:undo` is a safe no-op rather than a deeper rewind nobody can see.
//
// The one honest difference: `CompositionStore`'s 900 s window was ROLLING (any activity
// refreshed the whole entry), while `matchObservations` ages each observation
// independently against `nowTs`. A signal older than the window drops out of the
// composition on its own rather than being kept alive by a later scan. That is the
// reviewed rule for this phase and it fails in the safe direction — an aged-out weight
// leaves the entry incomplete and answerable by hand, rather than finalising against a
// measurement from a quarter of an hour ago.
//
// ## The commit REUSES the Phase-1 capture seam
//
// A committed scale entry must be indistinguishable from a typed/spoken/photographed one:
// `status: 'accepted'` with `settled: false` on every item. That is `stampUnsettled` (the
// extracted body of `NutribotInputRouter`'s own seam) followed by `AcceptFoodLog` — the
// same two steps, not a second commit path. `settled: false` is written verbatim; an
// ABSENT `settled` key is the migration signal for a legacy row and must never be
// manufactured by a default.
//
// The observation lifecycle (`open | consumed | dismissed`) is a SEPARATE field on a
// SEPARATE record from the entry's `status` (`pending | accepted | rejected | deleted`).
// Nothing here conflates them.

import { matchObservations } from '#domains/nutrition/services/ObservationMatcher.mjs';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';
import { stampUnsettled } from '#apps/nutribot/lib/unsettledStamp.mjs';

/** Matches the shipped bridge's default and `commit_quiet_sec`'s documented default. */
const DEFAULT_COMMIT_QUIET_MS = 25_000;

/** An empty composition read, in `CompositionStore.read`'s shape. */
const EMPTY_SNAPSHOT = Object.freeze({
  grams: null, unit: null, density: null, container: null,
  complete: false, active: false, observationIds: Object.freeze([]),
});

/**
 * Build the durable scale service.
 *
 * @param {object} deps
 * @param {{subscribe: (listener: Function) => Function}} deps.scaleGateway Named relay
 *   gateway for settled scale frames and button presses. NOT a generic event bus — the
 *   application layer describes capabilities, and the composition root owns the transport.
 * @param {object} deps.observationStore An `IObservationStore`.
 * @param {object} deps.nutribotContainer REQUIRED. Supplies `getLogFoodFromScale`,
 *   `getAcceptFoodLog`, `getSelectScaleDensity`, `getRetractScaleLog`. There is no
 *   "ledger only, no prompts" mode: `onPayload` cannot post, edit or commit without it,
 *   so a service built without one would record nothing and hear nothing while looking
 *   perfectly healthy — see the constructor guards.
 * @param {{findByUuid: Function, save: Function}|null} [deps.foodLogStore] For the
 *   `settled: false` stamp and for resolving the committed ITEM's uuid (which is what an
 *   observation pairs to — not the log's).
 * @param {string} deps.userId Whose observation ledger this is.
 * @param {string} [deps.conversationId] Where prompts go.
 * @param {object} [deps.scaleConfig] Thresholds; same keys the bridge read.
 * @param {string} [deps.timezone] IANA tz for the observation's LOCAL `at` timestamp.
 * @param {() => Date} deps.clock REQUIRED. One injected clock serves both the millisecond
 *   window math and the local timestamp, so the two can never disagree, and neither reads
 *   the wall clock directly.
 * @param {{setTimeout: Function, clearTimeout: Function}} deps.scheduler REQUIRED. The
 *   quiet interval must be drivable by hand in a test: the commit path awaits two use
 *   cases, and fake timers interleave badly with awaited promises here.
 * @param {number} [deps.commitQuietMs=25000]
 * @param {object} [deps.logger]
 * @returns {object} The service.
 */
export function createObservationService({
  scaleGateway,
  observationStore,
  nutribotContainer,
  foodLogStore = null,
  userId,
  conversationId = null,
  scaleConfig = {},
  timezone = undefined,
  clock,
  scheduler,
  commitQuietMs = DEFAULT_COMMIT_QUIET_MS,
  logger = console,
}) {
  // GUARD, do not degrade. The bridge threw on a missing event bus or container and that
  // was right: this is the kitchen scale's only path into the food log, and the failure a
  // permissive constructor produces is a service that starts, logs `ready`, and is
  // silently deaf — nobody notices until they wonder why a week of weighing never logged.
  // A boot-time throw is the cheap version of that discovery.
  if (typeof scaleGateway?.subscribe !== 'function') throw new Error('createObservationService: scaleGateway with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createObservationService: nutribotContainer required');
  if (!observationStore?.append) throw new Error('createObservationService: observationStore required');
  if (typeof userId !== 'string' || !userId) throw new Error('createObservationService: userId required');
  if (typeof clock !== 'function') throw new Error('createObservationService: clock required');
  if (!scheduler?.setTimeout || !scheduler?.clearTimeout) throw new Error('createObservationService: scheduler required');

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

  // TWO clocks, from ONE injected source, because they answer different questions.
  //
  // `nowMs` is real elapsed time and drives the suspicion window (was there a storm of
  // posts in the last 90 seconds).
  //
  // `matchNowMs` is "now" expressed in the SAME arithmetic space `ObservationMatcher`
  // parses observation timestamps into. That module reads a LOCAL `YYYY-MM-DD HH:mm:ss`
  // through `Date.UTC(...)` — using it purely as a combinator over the digits, never as
  // an instant — so handing it a raw epoch would compare a local wall clock against a UTC
  // one. In this household that is a seven- or eight-hour gap against a 900 s window:
  // every freshly written observation would read as expired and no composition would ever
  // form. Deriving it from the same formatted string the rows are written with makes the
  // two agree by construction.
  const LOCAL_TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const localNowString = () => formatLocalTimestamp(clock(), timezone);
  const nowMs = () => clock().getTime();
  const matchNowMs = () => {
    const m = LOCAL_TS_RE.exec(localNowString());
    if (!m) return clock().getTime();
    const [, y, mo, d, h, mi, sec] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  };

  // Per-scale PROMPT state only. Everything about the composition lives in the store —
  // this map holds nothing that matters across a restart except the prompt currently on
  // screen, which Telegram is itself the record of.
  //
  // `lastObservationId` is the exception worth naming: it is the one-deep undo cursor. It
  // does not survive a restart, and that is the safe direction — after a restart `rs:undo`
  // reports "nothing to undo" rather than guessing which row a person meant to take back.
  const scales = new Map();
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) {
      s = {
        baseline: null, lastGrams: null, live: null, postTimes: [],
        placed: false, commitTimer: null, committedGrams: null, lastObservationId: null,
      };
      scales.set(id, s);
    }
    return s;
  };

  // ==================== The durable ledger ====================

  /**
   * Append one signal. Best-effort in exactly the way the bridge's buffer writes were: a
   * store failure must never break the prompt flow, which works on its own and is what
   * the person is looking at.
   *
   * @returns {object|null} the persisted row, or null when the write failed.
   */
  const appendObservation = (scaleId, kind, value, unit = null) => {
    try {
      const record = observationStore.append(userId, {
        kind, value, unit, scaleId, at: localNowString(),
      });
      stateFor(scaleId).lastObservationId = record.id;
      logger.debug?.('observation.appended', { scaleId, kind, value, unit, id: record.id });
      return record;
    } catch (err) {
      logger.warn?.('observation.append.failed', { scaleId, kind, value, unit, error: err.message });
      return null;
    }
  };

  /**
   * Recompute the in-progress composition for one scale from its open rows.
   *
   * `entries: []` on purpose. `matchObservations` also answers "does this observation
   * belong to an ALREADY-EXISTING food-log entry" — retroactive enrichment — and that
   * half is Task 5.4's surface (the day view's pair / re-pair flow). Turning it on inside
   * the unattended commit path would mean a weight could silently attach itself to a
   * typed entry instead of prompting, which is a behaviour change nobody asked this task
   * for, on working hardware. The composition half is what this service needs and is all
   * it asks for.
   */
  const compositionFor = (scaleId) => {
    let open;
    try {
      open = observationStore.openForScale(userId, scaleId);
    } catch (err) {
      // A CORRUPT file is deliberately distinguishable from an empty day and must not be
      // read as "nothing is in progress" — but it also cannot be allowed to take the
      // prompt down, so it degrades to "no composition" with a loud line.
      logger.warn?.('observation.read.failed', { scaleId, error: err.message, code: err.code ?? null });
      return null;
    }
    const { composition } = matchObservations({ observations: open, entries: [], nowTs: matchNowMs() });
    return composition;
  };

  /**
   * The composition snapshot, in `CompositionStore.read`'s shape so every existing
   * consumer (`ApplyScanToComposition`, `LogFoodFromScale`'s `resolveScaleNet`, the prompt
   * renderer) reads it unchanged. `observationIds` rides along as an extra field: the
   * commit needs to know which rows it is consuming, and a snapshot that named its own
   * evidence is the only way `rs:done` — which reads BEFORE the slots are consumed — can
   * hand that evidence forward.
   */
  const read = (scaleId) => {
    const c = compositionFor(scaleId);
    if (!c) return { ...EMPTY_SNAPSHOT, observationIds: [] };
    return {
      grams: c.grams, unit: c.unit, density: c.density, container: c.container,
      complete: c.complete, active: true, observationIds: c.observationIds,
    };
  };

  /**
   * Move a set of rows out of `open`. ALL-OR-NOTHING via `updateMany` — a completed
   * composition consumes up to three rows into one entry, and two of them flipping while
   * a third stayed open is exactly the mismatch nothing downstream could detect.
   */
  const resolveObservations = (scaleId, ids, patch) => {
    if (!ids?.length) return false;
    try {
      observationStore.updateMany(userId, ids.map((id) => ({ id, ...patch })));
      return true;
    } catch (err) {
      logger.warn?.('observation.resolve.failed', {
        scaleId, ids, status: patch?.status ?? null, error: err.message,
      });
      return false;
    }
  };

  // ==================== The composition surface ====================
  //
  // Shaped exactly like `CompositionStore` so `ApplyScanToComposition` — which owns the
  // fridge grammar, the config lookups and the ack payloads — is reused verbatim rather
  // than reimplemented against a new interface.

  const setWeight = (scaleId, payload) => {
    appendObservation(scaleId, 'weight', payload?.grams, payload?.unit ?? null);
    return read(scaleId);
  };

  const setDensity = (scaleId, level) => {
    appendObservation(scaleId, 'density', level, null);
    return read(scaleId);
  };

  const setContainer = (scaleId, containerId) => {
    appendObservation(scaleId, 'container', containerId, null);
    return read(scaleId);
  };

  /**
   * Consume the composition at the end of a placement — the bridge's session-end
   * crossing, and the store half of `rs:done`.
   *
   * The rows become `dismissed` rather than vanishing: an observation that arrived and
   * was judged not to matter is evidence, and it is what someone debugging "why didn't my
   * weight show up" needs to see. A successful commit gets there first and marks them
   * `consumed` instead.
   *
   * @returns {boolean} whether there was anything live to consume.
   */
  const endPlacement = (scaleId) => {
    const c = compositionFor(scaleId);
    stateFor(scaleId).lastObservationId = null;  // a finished placement has no step to undo
    if (!c) return false;
    resolveObservations(scaleId, c.observationIds, { status: 'dismissed' });
    return true;
  };

  /** `rs:clear` — discard the in-progress composition. Mechanically endPlacement; a
   * different statement about the world, kept separate for the same reason the store
   * keeps them separate. */
  const clear = (scaleId) => {
    const c = compositionFor(scaleId);
    stateFor(scaleId).lastObservationId = null;
    if (!c) return false;
    resolveObservations(scaleId, c.observationIds, { status: 'dismissed' });
    logger.info?.('observation.cleared', { scaleId, count: c.observationIds.length });
    return true;
  };

  /**
   * `rs:undo` — take back the most recent scan. ONE DEEP, on purpose.
   *
   * The setters overwrite (the later row wins), so rescanning already repairs a WRONG
   * slot. Undo exists for the repair rescanning cannot express: taking a slot back to
   * empty. The cursor is consumed by the undo that used it, so a second consecutive
   * `rs:undo` is a no-op rather than a rewind of the rewind — the sheet has one undo cell
   * and a person cannot count how deep they are.
   */
  const undo = (scaleId) => {
    const s = stateFor(scaleId);
    const id = s.lastObservationId;
    if (!id) return false;
    s.lastObservationId = null;
    const c = compositionFor(scaleId);
    // Expired, cleared, or already consumed: there is nothing left to take back.
    if (!c || !c.observationIds.includes(id)) return false;
    return resolveObservations(scaleId, [id], { status: 'dismissed' });
  };

  // ==================== Quiet commit ====================

  const armCommit = (id, s) => {
    if (!commitQuietMs) return;
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

  const compositionOf = (scaleId) => {
    try { return read(scaleId); }
    catch (err) { logger.warn?.('observation.composition.read.failed', { scaleId, error: err.message }); return null; }
  };

  const create = (grams, scaleId, unit = 'g') =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit, scaleId,
      composition: compositionOf(scaleId),
    });

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

  /**
   * Finalise the placement: re-sync the persisted weight, apply the density, stamp the
   * items unsettled, accept, and CONSUME the observations into the entry.
   *
   * @param {string} id scale id
   * @param {object} s per-scale prompt state
   * @param {object|null} [snapshotOverride] composition to commit against, for a caller
   *   that has already consumed the slots — `rs:done` reads the snapshot BEFORE
   *   `endPlacement` resolves the rows and hands it here, which is the only way "process
   *   it now" can mean anything.
   * @returns {Promise<boolean>} whether an entry was accepted.
   */
  const commitNow = async (id, s, snapshotOverride = null) => {
    if (!s.live) return false;
    const snapshot = snapshotOverride ?? read(id);

    if (!snapshot?.complete) {
      logger.info?.('scaleNutribot.commit.skipped', { id, reason: 'incomplete' });
      return false;
    }

    // A volume cannot be multiplied by a kcal-per-GRAM density, so a millilitre reading
    // must never finalise itself. Here and not on "is the composition complete" — see the
    // module docstring. An absent unit is grams (the relay contract).
    const unit = snapshot.unit ?? 'g';
    if (unit !== 'g') {
      logger.warn?.('scaleNutribot.commit.skipped', { id, reason: 'non-gram-unit', unit });
      logger.warn?.('observation.commit.refused', { id, reason: 'non-gram-unit', unit });
      return false;
    }

    const uc = nutribotContainer.getAcceptFoodLog?.();
    if (!uc) return false;

    // CLAIM the prompt before awaiting, and give it back if anything fails. The accept is
    // awaited, and a scan arriving during that await re-arms the clock; leaving the prompt
    // claimable for the whole flight let a timer that came round again accept the SAME
    // logUuid twice — a silent duplicate in nutrition history.
    const live = s.live;
    s.live = null;

    const applyDensity = nutribotContainer.getSelectScaleDensity?.();
    if (!applyDensity) {
      s.live = live;
      logger.warn?.('scaleNutribot.commit.skipped', { id, reason: 'no-density-usecase' });
      return false;
    }

    // RE-SYNC the persisted entry against the composition we are about to multiply. That
    // covers a `ct:` scan whose ACK refresh was dropped (so the tare existed only in the
    // ledger and the density would have multiplied GROSS grams), and it is also how the
    // commit notices a human: `LogFoodFromScale` reports `touched: true` once
    // `metadata.densityLevel` is set, so the commit stands down rather than reverting a
    // tapped correction and accepting it under somebody's hand.
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
      if (String(err?.code || '').startsWith('NUTRIBOT_SCALE_')) {
        logger.warn?.('scaleNutribot.commit.skipped', {
          id, reason: 'density-failed', level: snapshot.density, error: err.message,
        });
        return false;
      }
      throw err;
    }
    // A refusal ('unknown level', 'log not found', 'already processed') means the entry
    // has no calories, so accepting it would write exactly the wrong data. Stand down and
    // leave the prompt live — the human can still answer it.
    if (!applied?.success) {
      s.live = live;
      logger.warn?.('scaleNutribot.commit.skipped', {
        id, reason: 'density-failed', level: snapshot.density, error: applied?.error ?? null,
      });
      return false;
    }

    // THE PHASE-1 SEAM. A committed scale entry has to be indistinguishable from a typed
    // or spoken one, and `settled: false` is what makes the day view offer to settle it.
    // AFTER the density (which rewrites item 0 wholesale) and BEFORE the accept (which
    // syncs the nutrilist), or the stamp is written and then overwritten, or synced and
    // then stamped.
    const stamped = await stampUnsettled({
      foodLogStore, userId, logId: live.logUuid, source: 'scale', logger,
    });
    // An observation pairs to the ITEM, not the log: the day view, `settlement.mjs` and
    // `ObservationMatcher` all key on the item's uuid.
    const entryUuid = stamped[0]?.uuid ?? null;

    try {
      await uc.execute({ userId, conversationId, logUuid: live.logUuid, messageId: live.messageId });
    } catch (err) {
      s.live = live;
      throw err;
    }

    // CONSUME the observations INTO the entry, and record the pairing. This is the
    // durable replacement for `bufferEndPlacement`: the rows do not vanish, they point at
    // what they became. AFTER the accept and on no refusal path — an entry that did not
    // commit still needs its signals.
    if (!entryUuid) {
      logger.warn?.('observation.commit.unpaired', { id, logUuid: live.logUuid });
    }
    resolveObservations(id, snapshot.observationIds, {
      status: 'consumed', pairedEntryUuid: entryUuid,
    });
    stateFor(id).lastObservationId = null;

    // MARK THE PLACEMENT COMMITTED, or the very next frame re-prompts for it. A commit
    // only ever happens with the food still on the pan, and the relay broadcasts every
    // raw frame, so the next settle arrives ~250 ms after the accept with no live prompt
    // to dedup against. Without this the mainline success path posted a duplicate prompt
    // for food already filed, and answering it double-counted the meal.
    s.committedGrams = live.grams;

    logger.info?.('scaleNutribot.commit.committed', {
      id, logUuid: live.logUuid, grams: snapshot.grams, density: snapshot.density,
      container: snapshot.container ?? null,
    });
    logger.info?.('observation.commit.committed', {
      id, logUuid: live.logUuid, entryUuid, grams: snapshot.grams, density: snapshot.density,
      container: snapshot.container ?? null, observations: snapshot.observationIds.length,
    });
    return true;
  };

  // ==================== The prompt flow ====================

  const post = async (id, s, grams, reason, unit = 'g') => {
    if (s.live) { await retract(s.live); s.live = null; }
    const res = await create(grams, id, unit);
    if (res?.success && res.logUuid) {
      s.live = { logUuid: res.logUuid, messageId: res.messageId || null, grams, unit };
      // A fresh prompt supersedes the committed marker: whatever was filed before, THIS
      // is what the pan holds now.
      s.committedGrams = null;
      s.postTimes.push(nowMs());
      setWeight(id, { grams, unit });
      armCommit(id, s);
      logger.info?.('scaleNutribot.pushed', { id, grams, unit, reason });
    }
    return res;
  };

  const suspicious = (s, grams, rise) => {
    if (storageWeightG > 0 && Math.abs(grams - storageWeightG) <= storageTolG) return 'storage-band';
    const cutoff = nowMs() - suspicionWindowMs;
    s.postTimes = s.postTimes.filter((t) => t >= cutoff);
    if (s.postTimes.length >= stormMinPushes && rise >= heavyG) return 'jump-after-storm';
    return null;
  };

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    // Reported by the relay on every frame; a missing unit stays grams — the existing
    // contract, which must not change.
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
          if (res?.edited) {
            s.live.grams = g; s.live.unit = unit;
            setWeight(id, { grams: g, unit });
            armCommit(id, s);
            return;                                        // already handled → no duplicate
          }
          if (res?.touched) s.live = null;                  // answered → post fresh below
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
        // CLOSED, not retracted. Retracting swept a 95 g prompt sixteen seconds after
        // posting it because the food had been picked up — which is the ordinary way to
        // use a kitchen scale. Closing keeps it answerable while stopping it being the
        // target of edit-in-place, so the next placement goes down the normal
        // floor/suspicion path and `post()` supersedes it properly.
        if (s.live) s.live.closed = true;
        // Consume on the CROSSING only. `rise <= baselineTolG` is also true on every
        // at-rest heartbeat, and consuming per frame would eat a scan made before the
        // food is set down — which is the scan-first flow this whole feature supports.
        if (s.placed) {
          s.placed = false;
          s.committedGrams = null;
          disarmCommit(s);
          endPlacement(id);
        }
        s.baseline = grams;
        return;
      }

      // Something is on the scale. Set BEFORE the floor/suspicion guards so a placement
      // they suppress still ENDS — otherwise its scans survive and the next food inherits
      // a density and tare that belong to nothing.
      s.placed = true;

      if (grams < minGrams) return;         // floor guard

      // LOADING: one live prompt follows the weight. Only a prompt belonging to THIS
      // placement may be followed — a closed one is a past placement still awaiting an
      // answer and must not be repainted.
      if (s.live && !s.live.closed) {
        if (Math.abs(grams - s.live.grams) < dedupDeltaG) {
          logger.debug?.('observation.prompt.deduped', { id, grams, live: s.live.grams, reason: 'held-value' });
          return;
        }
        const res = await editInPlace(grams, id, s.live, null, unit);
        if (res?.edited) {
          s.live.grams = grams; s.live.unit = unit;
          setWeight(id, { grams, unit });
          armCommit(id, s);
          return;                                           // still unanswered → followed
        }
        if (res?.touched) s.live = null;                    // answered → fall to new placement
        else return;                                        // dispatch failed → bail
      }

      // NEW PLACEMENT — unless this weight is the one that was JUST committed and never
      // left the pan. The dedup guard above cannot catch it (the commit nulled `s.live`),
      // and without this the mainline success path posts a duplicate prompt for food
      // already filed.
      if (Number.isFinite(s.committedGrams) && Math.abs(grams - s.committedGrams) < dedupDeltaG) {
        logger.info?.('observation.prompt.deduped', { id, grams, committed: s.committedGrams, reason: 'already-committed' });
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
   * Re-render the live prompt after its composition changed (a `ct:`/`dl:` scan).
   *
   * Takes the SAME per-scale lock as the frame handler and DROPS the refresh when the
   * scale is busy rather than queuing behind it: scanning while the scale settles is the
   * normal interaction, and going straight to `editInPlace` raced — it could edit a
   * message `post()` had just retracted, which Telegram answers with a 400 and the user
   * sees no ACK at all. Dropping loses nothing; the observation is already written, so
   * the in-flight weight edit reads it and renders the new state anyway.
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

  /**
   * Restart the quiet-commit clock after an APPLIED scan. A `dl:`/`ct:` scan arrives on a
   * different path entirely, so it needs its own way back in. A no-op for a scale with no
   * prompt yet — a scan may legitimately precede the placement, and there is nothing to
   * finalise until a weight posts a prompt of its own.
   */
  const armCommitFor = (scaleId) => {
    const s = scales.get(scaleId);
    if (s) armCommit(scaleId, s);
  };

  /**
   * Finalise NOW, without waiting for the lull — the `rs:done` card.
   *
   * "The sequence is complete, process it" is the one gesture that means the wait is over.
   * The caller supplies the snapshot it read before consuming the rows, because by the
   * time this runs those rows are already resolved.
   *
   * Never rejects: this is called fire-and-forget from the scan path, which must not turn
   * a failed commit into a failed scan.
   */
  const commitNowFor = async (scaleId, snapshot = null) => {
    const s = scales.get(scaleId);
    if (!s) return false;
    disarmCommit(s);   // an immediate commit supersedes any pending lull rather than racing it
    try {
      return await commitNow(scaleId, s, snapshot);
    } catch (err) {
      logger.warn?.('scaleNutribot.commit.failed', { id: scaleId, error: err.message });
      return false;
    }
  };

  const unsubscribe = scaleGateway.subscribe(onPayload);

  logger.info?.('observation.service.ready', {
    conversationId, userId, minGrams, baselineTolG, placementDeltaG, dedupDeltaG,
    storageWeightG, storageTolG, stormMinPushes, heavyG, forceTolG, commitQuietMs,
  });

  return {
    // Composition surface (drop-in for CompositionStore).
    setWeight, setDensity, setContainer, endPlacement, clear, undo, read,
    // Prompt surface (drop-in for ScaleNutribotBridge).
    refreshPrompt, armCommitFor, commitNowFor,
    dispose: () => {
      // Disarm FIRST: an unsubscribed service that still holds a pending timer would fire
      // into a torn-down container.
      for (const s of scales.values()) disarmCommit(s);
      try { unsubscribe?.(); } catch { /* noop */ }
    },
  };
}

export default createObservationService;
