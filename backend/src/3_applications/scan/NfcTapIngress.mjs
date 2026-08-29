/**
 * nfcTapIngress — coordinates an observed NFC tap into a trigger event and
 * hands it to the one pipeline every other
 * reader in the house already uses.
 *
 * Layer: APPLICATION. The input source, shutdown command projection, and
 * trigger workflow are semantic capabilities supplied by composition.
 *
 * It used to hold the "who owns this tag" decision as an if-chain, which meant
 * a learner card worked at exactly one reader in the house — the only one whose
 * taps arrive over this bus. That decision now lives where both ingress doors
 * already converge: `school_learner` is an actionable field in `NfcResolver`,
 * and the reader location's `learner_action` decides what it means. Two
 * divergences died with the fork: this module read `tag.global.school_learner`
 * only (ignoring a per-reader override the HTTP door honoured), and it passed
 * the raw YAML value where the resolver coerces and validates it.
 *
 * The `agenda-suppressed` acknowledgement moved with the fork, into the
 * `print-agenda` learner action (`learnerCardActions.mjs`) — where the
 * suppression is actually known. Transport has no opinion to broadcast.
 *
 * THE SHUTDOWN TAG IS THE ONE EXCEPTION AND IT STAYS. Its UID lives in
 * `shutdown.yml` rather than the tag registry, it is a household safety command
 * rather than a media or identity tag, and it must outrank everything —
 * including the reader map, so a reader missing from that map cannot turn the
 * safety command into `unmapped_reader`. Moving it into the registry is a config
 * migration on a safety path — separate work, deliberately not taken here.
 *
 * @module applications/scan/NfcTapIngress
 */
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

/**
 * @param {object} deps
 * @param {{observe: Function}} deps.tapSource
 * @param {{handleEvent: Function}} [deps.triggerDispatchService]
 * @param {{activate: Function}} [deps.shutdownService]
 * @param {Function} [deps.getShutdownCommand] resolves `{tagUid, readerId}` on every tap
 * @param {Record<string,string>} [deps.readerLocations] reader id -> trigger
 *   location. Was a single global `location`, which assumed every reader on
 *   this bus was in one room.
 * @param {object} [deps.logger]
 * @returns {{ wired: boolean, dispose: Function, handleTap: Function }}
 */
export function createNfcTapIngress({
  tapSource,
  triggerDispatchService = null,
  shutdownService = null,
  getShutdownCommand = null,
  readerLocations = {},
  logger = console,
} = {}) {
  if (!tapSource?.observe) {
    return { wired: false, dispose: () => {}, handleTap: async () => ({ status: 'not_wired' }) };
  }

  /**
   * @param {{uid: string, id?: string}} tap
   * @returns {Promise<{status: string, reader?: string|null}>}
   */
  async function handleTap({ uid, id = null } = {}) {
    const canonical = canonicalizeNfcUid(uid);
    if (!canonical) {
      logger.warn?.('nfc.tap.no_uid', { reader: id });
      return { status: 'no_uid' };
    }

    const shutdown = getShutdownCommand?.() ?? null;
    const shutdownUid = canonicalizeNfcUid(shutdown?.tagUid);
    const shutdownReaderId = shutdown?.readerId ?? null;
    if (shutdownService?.activate && shutdownUid === canonical && (!shutdownReaderId || shutdownReaderId === id)) {
      const state = await shutdownService.activate({ readerId: id, tagUid: canonical });
      logger.info?.('nfc.tap.shutdown', { reader: id, uid: canonical, lockedUntil: state?.lockedUntil });
      return { status: 'shutdown_locked', lockedUntil: state?.lockedUntil };
    }

    const location = readerLocations?.[id] ?? null;
    if (!triggerDispatchService?.handleEvent || !location) {
      // Named rather than silent: a reader nobody mapped is a config gap, and
      // the log line carries the ids that would have fixed it.
      logger.warn?.('nfc.tap.unmapped_reader', {
        reader: id, uid: canonical, known: Object.keys(readerLocations ?? {}),
      });
      return { status: 'unmapped_reader', reader: id };
    }

    const outcome = await triggerDispatchService.handleEvent({ location, source: 'nfc', value: canonical });
    logger.info?.('nfc.tap.trigger', {
      reader: id, uid: canonical, location, ok: outcome?.ok, code: outcome?.code ?? null,
    });
    return { status: outcome?.ok ? 'triggered' : (outcome?.code ?? 'trigger_failed') };
  }

  const unsubscribe = tapSource.observe((payload) => {
    if (payload?.event !== 'nfc') return;
    // Never let an observed tap reject into the input source without attribution.
    Promise.resolve(handleTap({ uid: payload.uid, id: payload.id }))
      .catch((err) => logger.warn?.('nfc.tap.failed', { uid: payload?.uid, error: err?.message }));
  });

  logger.info?.('nfc.tap.ingress.ready', {
    readers: Object.keys(readerLocations ?? {}), trigger: !!triggerDispatchService?.handleEvent,
  });

  return {
    wired: true,
    handleTap,
    dispose: () => { try { unsubscribe?.(); } catch { /* already gone */ } },
  };
}

export default createNfcTapIngress;
