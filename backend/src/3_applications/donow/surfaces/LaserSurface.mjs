/**
 * LaserSurface — the DoNow adapter for the household laser printer (spec §5,
 * surface id `laser`).
 *
 * v1 is DEFERRED-thin: the spec names an authorized-actor path over
 * `PrintService` (quota-exempt but still attributed) as the eventual shape;
 * this adapter only wires the injected `issueOrPrint` port through and
 * accepts a bare `{ document? }` action — the richer `printableRef`
 * addressing is out of scope here.
 *
 * Attribution logging is NON-OPTIONAL (unlike every other adapter's
 * best-effort logging): every dispatch call logs `donow.laser.print
 * {learnerId, requestedBy}` at `info`, whether or not a printer is actually
 * wired — a laser job with no attribution trail is exactly the failure mode
 * the household's quota/attribution system exists to prevent, so this is
 * logged even on a no-op degrade.
 *
 * Occupancy is always `idle` — like the thermal printer, a queue, not a
 * stage.
 */
export class LaserSurface {
  #issueOrPrint;
  #logger;

  /**
   * @param {Object} config
   * @param {{print: Function}} [config.issueOrPrint] - authorized-actor print port; optional
   * @param {Object} [config.logger]
   */
  constructor({ issueOrPrint = null, logger = console } = {}) {
    this.#issueOrPrint = issueOrPrint;
    this.#logger = logger;
  }

  get id() { return 'laser'; }

  /** @param {{document?: object, requestedBy?: string}} raw */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (raw.document !== undefined && (raw.document === null || typeof raw.document !== 'object')) {
      return ['action.document, when present, must be an object'];
    }
    return [];
  }

  /** @returns {Promise<{state: 'idle', occupantId: null}>} */
  async occupancy() {
    return { state: 'idle', occupantId: null };
  }

  /** @returns {Promise<{dispatched: boolean, detail?: *}>} */
  async dispatch({ action, learnerId }) {
    const requestedBy = action?.requestedBy ?? null;
    // NON-OPTIONAL: logged unconditionally, even when no printer is wired —
    // attribution is the whole point of the authorized-actor path.
    this.#logger.info?.('donow.laser.print', { learnerId, requestedBy });

    if (!this.#issueOrPrint) return { dispatched: false };
    try {
      const result = await this.#issueOrPrint.print(action.document, { learnerId, requestedBy });
      return { dispatched: true, detail: result };
    } catch (err) {
      this.#logger.warn?.('donow.laser.print-failed', { error: err?.message || String(err) });
      return { dispatched: false };
    }
  }

  label() { return 'A print job on the laser printer'; }
}

export default LaserSurface;
