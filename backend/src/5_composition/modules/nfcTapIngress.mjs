/**
 * nfcTapIngress — routes an NFC tap arriving on a hardware-relay bus topic to
 * whoever owns that tag.
 *
 * Layer: COMPOSITION (5_composition/modules). Wires existing pieces; contains no
 * policy of its own beyond "who owns this tag".
 *
 * WHY THIS EXISTS: the household has two kinds of NFC tag on identical hardware.
 * A book sticker means "play this audiobook" — its meaning IS an action, and the
 * trigger pipeline already handles it. A personal card means "this is a learner", and
 * what happens next is School's planner decision, not a fixed action.
 *
 * So the split follows the rule the school roadmap already states for barcode:
 * the relay stays transport-only, and School is a resolver namespace downstream
 * of it. One tag registry answers WHAT a tag is; the owning domain decides what
 * happens.
 *
 *   tag has `school_learner`  -> School ResolvePersonalCard (prints the agenda)
 *   anything else             -> TriggerDispatchService (books, lights, …)
 *
 * The registry is shared, not copied: `triggerConfig.nfc.tags` is the same object
 * the trigger repository mutates when a tag is renamed, so a card enrolled at
 * runtime is visible here without a reload.
 *
 * @module composition/modules/nfcTapIngress
 */
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

/** Tag field naming the learner a personal card belongs to. */
export const SCHOOL_LEARNER_FIELD = 'school_learner';

/**
 * @param {object} deps
 * @param {{subscribe: Function, broadcast?: Function}} deps.eventBus - `broadcast`
 *   is optional (`?.()` at every call site): a bus double that only
 *   implements `subscribe` — every existing test harness for this module —
 *   still works, it just never gets to acknowledge a cooldown-suppressed tap
 *   on the wire (Slice G).
 * @param {string[]} [deps.topics] bus topics carrying relay `nfc` events
 * @param {object} deps.triggerConfig the live unified registry ({ nfc: { tags } })
 * @param {{handleEvent: Function}} [deps.triggerDispatchService]
 * @param {{execute: Function}} [deps.resolvePersonalCard] School use case
 * @param {string} [deps.location] NFC reader location for non-school tags
 * @param {object} [deps.logger]
 * @returns {{ wired: boolean, dispose: Function, handleTap: Function }}
 */
export function createNfcTapIngress({
  eventBus,
  topics = ['omr'],
  triggerConfig = null,
  triggerDispatchService = null,
  resolvePersonalCard = null,
  shutdownService = null,
  getShutdownConfig = null,
  location = null,
  logger = console,
} = {}) {
  if (!eventBus?.subscribe) {
    return { wired: false, dispose: () => {}, handleTap: async () => ({ status: 'not_wired' }) };
  }

  /**
   * @param {{uid: string, id?: string}} tap
   * @returns {Promise<{status: string, learnerId?: string|null}>}
   */
  async function handleTap({ uid, id = null } = {}) {
    const canonical = canonicalizeNfcUid(uid);
    if (!canonical) {
      logger.warn?.('nfc.tap.no_uid', { reader: id });
      return { status: 'no_uid' };
    }

    const tag = triggerConfig?.nfc?.tags?.[canonical] ?? null;
    // This deliberately precedes the learner-card branch: the shutdown tag is
    // a household safety command, not a learner identity or media trigger.
    const shutdown = getShutdownConfig?.() ?? null;
    const shutdownUid = typeof shutdown?.nfc?.tag_uid === 'string'
      ? canonicalizeNfcUid(shutdown.nfc.tag_uid) : null;
    const shutdownReaderId = shutdown?.nfc?.reader_id ?? null;
    if (shutdownService?.activate && shutdownUid === canonical && (!shutdownReaderId || shutdownReaderId === id)) {
      const state = await shutdownService.activate({ readerId: id, tagUid: canonical });
      logger.info?.('nfc.tap.shutdown', { reader: id, uid: canonical, lockedUntil: state.lockedUntil });
      return { status: 'shutdown_locked', lockedUntil: state.lockedUntil };
    }
    const learnerId = tag?.global?.[SCHOOL_LEARNER_FIELD] ?? null;

    if (learnerId) {
      if (!resolvePersonalCard?.execute) {
        // A card IS enrolled but School is not wired. Reported, not swallowed:
        // a child tapping a registered card and getting nothing is the exact
        // failure the school spec calls out as worse than no card at all.
        logger.error?.('nfc.tap.school_unwired', { reader: id, uid: canonical, learnerId });
        return { status: 'school_unwired', learnerId };
      }
      const result = await resolvePersonalCard.execute({ learnerId });
      logger.info?.('nfc.tap.school_card', {
        reader: id, uid: canonical, learnerId, status: result?.status, printed: result?.printed,
      });
      // Rule 3 (Slice G, 2026-08-22-omr-grading-integrity): a cooldown-suppressed
      // tap still gets ACKNOWLEDGED — no paper, but the panel must say
      // something, or a child who taps and gets nothing at all just taps
      // harder, which is the exact behaviour the cooldown exists to stop.
      // Broadcast on the SAME `omr` topic Slice D's `useScanCeremony.js`
      // already subscribes to (via `schoolPrintScanConsumer.mjs`'s own
      // `scan-graded`/`scan-review`/... precedent) — no new transport.
      if (result?.status === 'agenda_suppressed') {
        eventBus.broadcast?.('omr', {
          event: 'agenda-suppressed',
          learnerId,
          sinceMinutes: result.sinceMinutes ?? null,
          cooldownMinutes: result.cooldownMinutes ?? null,
          timestamp: Date.now(),
        });
      }
      return { status: result?.status ?? 'unknown', learnerId };
    }

    // Not a school card. Hand it to the normal trigger pipeline so a book
    // sticker tapped on this reader behaves as it does on every other reader —
    // including the unknown-tag notify path that makes enrolment possible.
    if (!triggerDispatchService?.handleEvent || !location) {
      logger.debug?.('nfc.tap.unrouted', { reader: id, uid: canonical, hasLocation: !!location });
      return { status: 'unrouted' };
    }
    const outcome = await triggerDispatchService.handleEvent({
      location, source: 'nfc', value: canonical,
    });
    logger.info?.('nfc.tap.trigger', {
      reader: id, uid: canonical, location, ok: outcome?.ok, code: outcome?.code ?? null,
    });
    return { status: outcome?.ok ? 'triggered' : (outcome?.code ?? 'trigger_failed') };
  }

  const unsubscribers = topics.map((topic) => eventBus.subscribe(topic, (payload) => {
    if (payload?.event !== 'nfc') return;
    // Never let a tap reject into the bus: a subscriber throwing here would
    // surface as an unhandled rejection with no way to attribute it to a scan.
    Promise.resolve(handleTap({ uid: payload.uid, id: payload.id }))
      .catch((err) => logger.warn?.('nfc.tap.failed', { uid: payload?.uid, error: err?.message }));
  }));

  logger.info?.('nfc.tap.ingress.ready', {
    topics, location, school: !!resolvePersonalCard?.execute, trigger: !!triggerDispatchService?.handleEvent,
  });

  return {
    wired: true,
    handleTap,
    dispose: () => { for (const off of unsubscribers) { try { off?.(); } catch { /* already gone */ } } },
  };
}

export default createNfcTapIngress;
