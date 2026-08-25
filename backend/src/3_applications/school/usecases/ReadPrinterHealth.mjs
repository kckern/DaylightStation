/**
 * ReadPrinterHealth — "is the printer able to print right now?", in words a
 * seven-year-old standing at a wall panel can act on.
 *
 * WHY THIS EXISTS AT ALL. The self-service panel asks a child "Did it print?"
 * after a print action, and a child is the wrong person to ask. We cannot do
 * better per-JOB: the laser printer is driven fire-and-forget, and
 * `LaserPrinterAdapter#printPdf` resolves on SEND, not on paper — a jam does
 * not fail the print call on the real device either. But we can do much better
 * per-PRINTER: `getStatus()` reads IPP `printer-state` and
 * `printer-state-reasons`, so out-of-paper, jammed, cover-open and offline are
 * all knowable, just not attributable to one job. That is enough to stop
 * making a child adjudicate a jam.
 *
 * THE BAR FOR CALLING SOMETHING A FAULT IS DELIBERATELY HIGH.
 *
 * A false fault is worse than no fault: it replaces a question the child could
 * have answered ("yes, I have the paper") with a dead end that sends them to
 * find an adult who will find a working printer. So `healthy: false` requires
 * either the printer itself reporting `stopped`, or one of a NAMED set of
 * blocking reasons. IPP reason strings carry a severity suffix
 * (`-report` = informational, `-warning` = degraded-but-printing, bare or
 * `-error` = blocking), and anything non-blocking is stripped before the
 * check — `toner-low-warning` must never stop a child who is holding their
 * worksheet. An unrecognised bare reason on an otherwise-idle printer is NOT
 * treated as a fault, for the same reason.
 *
 * NEVER THROWS. A status read that fails is not knowledge that something is
 * wrong; it is an absence of knowledge, and it is reported as such
 * (`healthy: null`) so the caller falls back to asking. The panel treats
 * anything other than an explicit `healthy === false` as "keep asking".
 */

/**
 * Reasons that genuinely stop paper coming out, mapped to the sentence a child
 * gets. Order matters only in that the FIRST match wins, so the most specific
 * and most actionable cause is named when a printer reports several at once
 * (a jam plus a re-opened cover reads better as the jam).
 *
 * The strings are the IPP `printer-state-reasons` keywords (RFC 8011 §5.4.12)
 * after severity-suffix stripping. `media-needed` and `media-empty` are both
 * here because printers disagree about which one an empty tray is.
 */
const BLOCKING_REASONS = [
  [['media-jam', 'jam'], 'The printer is jammed — tell a grown-up.'],
  [['media-empty', 'media-needed', 'input-media-supply-empty'], 'The printer is out of paper — tell a grown-up.'],
  [['cover-open', 'door-open', 'interlock-open'], 'The printer is open — tell a grown-up.'],
  [['toner-empty', 'marker-supply-empty', 'developer-empty'], 'The printer is out of ink — tell a grown-up.'],
  [['output-area-full', 'output-tray-missing', 'input-tray-missing'], 'The printer needs a hand — tell a grown-up.'],
  [['offline', 'shutdown', 'connecting-to-device', 'timed-out'], "The printer isn't answering — tell a grown-up."],
  [['paused', 'moving-to-paused', 'stopped-partly'], 'The printer is paused — tell a grown-up.'],
];

/** The words for a printer that is stopped without saying why. */
const GENERIC_FAULT = 'Something is wrong with the printer — tell a grown-up.';

/** Severity suffixes IPP appends; `-report` and `-warning` are not blocking. */
const NON_BLOCKING_SUFFIXES = ['-report', '-warning'];

/**
 * Strip an IPP severity suffix, returning null for the severities that mean
 * "this is not stopping anything".
 */
function blockingKeyword(reason) {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return null;
  for (const suffix of NON_BLOCKING_SUFFIXES) {
    if (text.endsWith(suffix)) return null;
  }
  return text.endsWith('-error') ? text.slice(0, -'-error'.length) : text;
}

/**
 * @param {object} deps
 * @param {{ getStatus: () => Promise<object> }} [deps.printer] - the laser
 *   printer adapter. Absent (no printer configured for this deployment) is a
 *   legitimate state, not an error: it reports `healthy: null`, which reads as
 *   "we cannot tell" and leaves the caller's own fallback in charge.
 * @param {object} [deps.logger]
 */
export class ReadPrinterHealth {
  #printer;

  #logger;

  constructor({ printer = null, logger = console } = {}) {
    this.#printer = printer;
    this.#logger = logger;
  }

  /**
   * @returns {Promise<{ok: true, healthy: boolean|null, state: string|null,
   *   reasons: string[], sentence: string|null, reason: string|null}>}
   *   `healthy: null` means UNKNOWN — no printer wired, or the status read
   *   failed. Only an explicit `false` is a fault a caller may act on.
   *   `sentence` is present only alongside `healthy: false`.
   */
  async execute() {
    if (!this.#printer?.getStatus) {
      return { ok: true, healthy: null, state: null, reasons: [], sentence: null, reason: 'not_wired' };
    }
    let status;
    try {
      status = await this.#printer.getStatus();
    } catch (err) {
      // An unreachable printer is very likely a real problem, but it is not a
      // problem we can DESCRIBE, and a status read can also fail for reasons
      // that have nothing to do with paper (a slow IPP round-trip, a DNS
      // blip). Reporting "unknown" keeps a transient network hiccup from
      // replacing a working question with a dead end.
      this.#logger.warn?.('school.printer.status-failed', { error: err.message });
      return { ok: true, healthy: null, state: null, reasons: [], sentence: null, reason: 'status_failed' };
    }

    const state = status?.state ?? null;
    const reasons = Array.isArray(status?.stateReasons) ? status.stateReasons : [];
    const keywords = reasons.map(blockingKeyword).filter(Boolean);

    for (const [names, sentence] of BLOCKING_REASONS) {
      const hit = keywords.find((keyword) => names.includes(keyword));
      if (hit) {
        return { ok: true, healthy: false, state, reasons, sentence, reason: hit };
      }
    }
    // A `stopped` printer with nothing recognisable to say is still stopped.
    // This is the one place a fault is declared without knowing its cause, and
    // it is safe because `stopped` is the printer's OWN word for "not
    // printing" — not our inference from a reason string we did not recognise.
    if (state === 'stopped') {
      return { ok: true, healthy: false, state, reasons, sentence: GENERIC_FAULT, reason: 'stopped' };
    }
    // `unknown` state (an adapter that could not parse the attribute) is not a
    // fault — see the class comment on the cost of a false one.
    return { ok: true, healthy: true, state, reasons, sentence: null, reason: null };
  }
}

export default ReadPrinterHealth;
