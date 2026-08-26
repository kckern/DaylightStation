/**
 * learnerCardActions — the handlers registered into the trigger pipeline's
 * `learnerActions` registry, one per `learner_action` a reader can declare.
 *
 * Layer: COMPOSITION (5_composition/modules). It lives here, not in
 * `3_applications/trigger`, precisely because it is the seam where School meets
 * the trigger pipeline: the registry knows op names and nothing about School,
 * and this is what keeps it that way. Extracted from an inline arrow in
 * `app.mjs` so it can be tested without booting the app — the contract it holds
 * is worth more than the four lines it saves.
 *
 * @module composition/modules/learnerCardActions
 */

/**
 * The `print-agenda` learner action: School's ResolvePersonalCard, plus the
 * on-screen acknowledgement a cooldown-suppressed tap depends on.
 *
 * THE BROADCAST IS NOT OPTIONAL. A repeat tap inside the print cooldown gets no
 * paper, and this is that tap's ONLY feedback — without it a child who taps and
 * gets nothing just taps harder, which is the exact behaviour the cooldown
 * exists to stop. It rides the `omr` topic because `useScanCeremony.js` already
 * subscribes there; no new transport. It used to be broadcast by
 * `nfcTapIngress`, which is now transport-only and could not know a print had
 * been suppressed.
 *
 * IT IS ALSO BEST-EFFORT, AND THE OUTCOME IS NOT. `responseHandlers.learner`
 * turns a throw into `{ status: 'failed', retryable: true }` — so a broken bus
 * or a broken log transport would report a successful suppression as a failed
 * tap AND release the debounce, printing on the very next tap. Both are
 * swallowed here for that reason.
 *
 * @param {object} deps
 * @param {{execute: Function}} deps.resolvePersonalCard School use case
 * @param {{broadcast?: Function}} [deps.eventBus]
 * @param {object} [deps.logger]
 * @returns {(args: {learnerId: string, location?: string}) => Promise<object>}
 */
export function makePrintAgendaHandler({ resolvePersonalCard, eventBus, logger = console } = {}) {
  return async ({ learnerId, location } = {}) => {
    const result = await resolvePersonalCard.execute({ learnerId });

    try {
      logger?.info?.('nfc.tap.school_card', {
        location, learnerId, status: result?.status ?? null, printed: result?.printed ?? null,
      });
    } catch { /* the tap outranks the log line */ }

    if (result?.status === 'agenda_suppressed') {
      try {
        eventBus?.broadcast?.('omr', {
          event: 'agenda-suppressed',
          learnerId,
          // Null rather than absent: the panel would rather render "you already
          // have today's agenda" without a countdown than render nothing.
          sinceMinutes: result.sinceMinutes ?? null,
          cooldownMinutes: result.cooldownMinutes ?? null,
          timestamp: Date.now(),
        });
      } catch (err) {
        try { logger?.warn?.('nfc.tap.ack_failed', { location, learnerId, error: err?.message }); } catch { /* ignore */ }
      }
    }

    // `print_failed` is the one status that tells the child to scan again —
    // ResolvePersonalCard REPORTS it rather than throwing, so nothing else would
    // release the 30s trigger debounce and the retry it asked for would be
    // swallowed with the handler never invoked. Every other status is a finished
    // answer: a printed agenda and a cooldown suppression both WANT the lockout,
    // and an unknown learner is no more known on the next tap.
    if (result?.status === 'print_failed') return { ...result, retryable: true };

    return result ?? { status: 'unknown' };
  };
}

export default { makePrintAgendaHandler };
