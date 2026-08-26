/**
 * ResolvePersonalCard — the scan that starts everything (spec §6.1).
 *
 * A personal card never expires and is reusable forever. Whatever state a child
 * is in — nothing started, halfway through a video, holding a sheet they cannot
 * find, stuck on something a grown-up has to mark — scanning their card prints a
 * current list. It is the recovery path for every other failure in the system,
 * which is exactly why it carries no expiry and no preconditions.
 *
 * It builds the agenda, prints it, and hands back what happened. If the printer
 * refuses, that is reported rather than swallowed: the one thing worse than no
 * agenda is a child standing at a printer believing one is coming.
 *
 * COOLDOWN (Slice G, 2026-08-22-omr-grading-integrity): a child who taps
 * repeatedly — the printer never answering with anything new — burns tape and
 * learns that tapping harder helps. `school.yml agenda.cooldownMinutes`
 * silences a repeat print for the SAME content within the window, keyed on
 * **learnerId** (one child, however many cards they carry). Two things keep
 * this from being a blunt instrument:
 *
 *   1. **Suppression still acknowledges the tap** (`status: 'agenda_suppressed'`,
 *      `printed: false`, a real `message`) — never nothing. A caller that
 *      shows nothing on a real tap re-teaches the exact behaviour this exists
 *      to stop.
 *   2. **Changed content bypasses the cooldown entirely.** The comparison is a
 *      fingerprint of the agenda's OFFERS (`#agendaFingerprint`), not the
 *      rendered document — `BuildAgenda` mints a fresh token and timestamp on
 *      every single call, so hashing the document would make every rebuild
 *      look "new" and the cooldown would never engage at all.
 */
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** `school.yml agenda.cooldownMinutes` default — 0 disables the cooldown. */
const DEFAULT_AGENDA_COOLDOWN_MINUTES = 15;

/**
 * Artifact id convention for a printed agenda: `agenda/<learner>/<issuedAt>`.
 *
 * Namespaced like the receipt ids beside it (`receipt/<session>/<outcome>`), so
 * one `school/artifacts/issued/` tree holds every kind and the prefix says which
 * is which. The timestamp is the whole uniqueness story — a child may tap many
 * times a day and each printed page is its own record — and it sorts
 * chronologically, which is how you actually look for one ("what came out around
 * half four?").
 *
 * Exported because the CLI has to name the same artifact the printer wrote; a
 * convention duplicated as a template string in two files is a convention that
 * drifts.
 */
export function agendaArtifactId({ learnerId, issuedAt }) {
  return `agenda/${learnerId}/${issuedAt}`;
}

/**
 * Validated the same defensive way `IssueDocument`'s
 * `normalizePrintCooldownMinutes` is: this number gates every single card
 * scan in the house, so a malformed config value must fail loudly at
 * construction rather than silently never engaging (or never expiring).
 */
function normalizeCooldownMinutes(raw) {
  const minutes = raw ?? DEFAULT_AGENDA_COOLDOWN_MINUTES;
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('ResolvePersonalCard: cooldownMinutes must be a number >= 0');
  }
  return minutes;
}

/**
 * A stable fingerprint of what the agenda would print, deliberately
 * excluding the fields `BuildAgenda#execute` changes on EVERY call even when
 * nothing about the child's actual work did: a fresh `subject_next` token
 * per offer (so a stale ticket can't be replayed) and `document.generatedAt`
 * (stamped to the second). What genuinely means "new work" — a different
 * subject or unit on offer, a session that advanced to its next move — lives
 * in `offers[].subject/unitId/sessionId/label`, so that is the whole input.
 * Sorted so section-ordering noise between builds can never look like a
 * content change.
 */
function agendaFingerprint(agenda) {
  const offers = [...(agenda?.offers ?? [])]
    .map((o) => ({
      subject: o.subject ?? null,
      unitId: o.unitId ?? null,
      sessionId: o.sessionId ?? null,
      label: o.label ?? null,
    }))
    .sort((a, b) => {
      const bySubject = (a.subject ?? '').localeCompare(b.subject ?? '');
      return bySubject !== 0 ? bySubject : (a.unitId ?? '').localeCompare(b.unitId ?? '');
    });
  return stableRecordDigest({ offers });
}

export class ResolvePersonalCard {
  #buildAgenda; #receipts; #roster; #logger; #cooldown; #cooldownMinutes; #clock; #tokens; #captureAgenda;

  /**
   * One in-flight resolution per learner.
   *
   * `execute` is check-then-act — it reads the cooldown, then awaits a build
   * and a print, and only then arms the cooldown. Callers do not await it
   * (`nfcTapIngress.mjs:138` dispatches with a bare `Promise.resolve`), so on
   * 2026-08-25 five concurrent taps all passed the gate before any armed it:
   * five prints, four duplicate sessions.
   *
   * Keyed by learner so two children scanning at once still run in parallel.
   */
  #inFlightByLearner = new Map(); // learnerId -> Promise

  /**
   * @param {object} deps
   * @param {import('./BuildAgenda.mjs').BuildAgenda} deps.buildAgenda
   * @param {{print: (document: object) => Promise<{printed: boolean}>}} deps.receipts
   *   the receipt printing collaborator (render + thermal transport)
   * @param {{displayName: (learnerId: string) => string|null}} [deps.roster]
   * @param {import('../ports/IAgendaCooldownStore.mjs').IAgendaCooldownStore} [deps.cooldown]
   *   per-learner last-print record (Slice G). Absent, or `cooldownMinutes: 0`,
   *   and every scan prints exactly as it did before the feature existed.
   * @param {number} [deps.cooldownMinutes] - `school.yml agenda.cooldownMinutes`
   *   (default 15). `0` disables the cooldown outright.
   * @param {{execute: Function}} [deps.captureAgenda] - archives each printed
   *   agenda (document + rendered bytes) to the issued-artifact store. Optional
   *   and best-effort: absent, printing behaves exactly as it did before, and a
   *   capture that throws never fails a print. See `#captureAgendaArtifact`.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} [deps.tokens] -
   *   used ONLY to revoke a token minted by a tap that then got suppressed
   *   (L-5); a household that has not wired self-service access codes simply
   *   never has anything to revoke.
   */
  constructor({
    buildAgenda, receipts, roster = null, cooldown = null, cooldownMinutes = null,
    clock = () => new Date(), logger = console, tokens = null, captureAgenda = null,
  } = {}) {
    if (!buildAgenda || !receipts) throw new Error('ResolvePersonalCard requires buildAgenda and receipts');
    this.#buildAgenda = buildAgenda;
    this.#receipts = receipts;
    this.#captureAgenda = captureAgenda;
    this.#roster = roster;
    this.#cooldown = cooldown;
    this.#cooldownMinutes = normalizeCooldownMinutes(cooldownMinutes);
    this.#clock = clock;
    this.#logger = logger;
    this.#tokens = tokens;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId - resolved from the card's registry record
   * @returns {Promise<{ status: 'agenda_printed'|'agenda_suppressed'|'print_failed'|'unknown_learner',
   *                     learnerId: string|null, offers: object[], printed: boolean,
   *                     message: string, sinceMinutes?: number, cooldownMinutes?: number }>}
   */
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      return this.#executeInner({ learnerId });   // invalid-input path needs no lock
    }
    const prior = this.#inFlightByLearner.get(learnerId) ?? Promise.resolve();
    // Chain rather than reject: a second tap must WAIT and then see the armed
    // cooldown, so it reports `agenda_suppressed` — the honest answer the panel
    // already knows how to acknowledge — instead of failing.
    //
    // The waiter runs #executeInner AFTER the first call completes, so it
    // builds a FRESH agenda and re-reads the now-armed cooldown. That is the
    // whole point: a queued caller must not reuse state captured before the
    // print it was waiting on.
    const run = prior.catch(() => {}).then(() => this.#executeInner({ learnerId }));
    this.#inFlightByLearner.set(learnerId, run);
    try {
      return await run;
    } finally {
      if (this.#inFlightByLearner.get(learnerId) === run) this.#inFlightByLearner.delete(learnerId);
    }
  }

  async #executeInner({ learnerId }) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      const printed = await this.#receipts.print(noticeDocument({
        id: 'card-unknown',
        headline: 'Whose card is this?',
        lines: ['We could not tell who scanned. Ask a grown-up to set up your card.'],
      }));
      return { status: 'unknown_learner', learnerId: null, offers: [], printed: printed.printed, message: 'We do not know that card.' };
    }

    const learnerName = this.#roster?.displayName?.(learnerId) ?? null;
    const agenda = await this.#buildAgenda.execute({ learnerId, learnerName });

    // COOLDOWN (Slice G): checked BEFORE printing, on the agenda this call
    // already had to build to know what it would say. Skipped outright when
    // disabled (`cooldownMinutes: 0`) or no store was wired — both leave this
    // exactly the pre-Slice-G behaviour.
    if (this.#cooldownMinutes > 0 && this.#cooldown) {
      const suppressed = await this.#checkCooldown(learnerId, agenda);
      if (suppressed) return suppressed;
    }

    const outcome = await this.#receipts.print(agenda.document);

    if (!outcome.printed) {
      this.#logger.warn?.('school.card.print-failed', { learnerId, offers: agenda.offers.length });
      return {
        status: 'print_failed',
        learnerId,
        offers: agenda.offers,
        printed: false,
        message: 'Your list is ready but the printer did not answer. Try scanning again.',
      };
    }

    if (this.#cooldown) await this.#armCooldown(learnerId, agenda);

    const artifactId = await this.#captureAgendaArtifact(learnerId, agenda);

    this.#logger.info?.('school.card.agenda-printed', {
      learnerId, offers: agenda.offers.length, created: agenda.createdSessions.length, artifactId,
    });
    return {
      status: 'agenda_printed',
      learnerId,
      offers: agenda.offers,
      printed: true,
      message: 'Printing your list.',
    };
  }

  /**
   * Archive what just came off the printer.
   *
   * Until this existed the agenda was rendered to a scratch PNG, printed, and
   * unlinked — so the only trace of a page a child was holding was one log line
   * saying a page had existed. "This block is broken, look at it" had no answer
   * short of standing at the printer with a camera, and by the time anyone
   * asked, the state that produced it had moved on.
   *
   * The manifest keeps `sourceDocument` — the renderer's INPUT — beside the
   * bytes. Bytes alone are an archive; the document is what can be fed back
   * through a renderer you have since changed, which is what makes a layout fix
   * verifiable against the page that actually went wrong rather than against
   * invented test data. A later renderer will not reproduce the old pixels
   * exactly, and that is fine and expected — the contract here is that the DATA
   * and STATE as of the printout survive faithfully.
   *
   * BEST EFFORT, ALWAYS. This runs after the paper is already in a child's
   * hand. An archive that can turn a successful print into a failed scan has
   * its priorities backwards, so every failure here is a warning and nothing
   * more.
   *
   * @returns {Promise<string|null>} the artifact id, or null if not captured
   */
  async #captureAgendaArtifact(learnerId, agenda) {
    if (!this.#captureAgenda?.execute || !agenda?.document) return null;
    const issuedAt = this.#clock().toISOString();
    const artifactId = agendaArtifactId({ learnerId, issuedAt });
    try {
      await this.#captureAgenda.execute({
        artifactId, learnerId, issuedAt, kind: 'agenda', document: agenda.document,
        // An agenda spans whatever sessions it happens to offer rather than
        // belonging to one, so there is no single sessionId to record here.
        sessionId: null,
      });
      return artifactId;
    } catch (err) {
      this.#logger.warn?.('school.card.agenda-capture-failed', {
        learnerId, artifactId, error: err.message,
      });
      return null;
    }
  }

  /**
   * @returns {Promise<object|null>} a ready-to-return `agenda_suppressed`
   *   response, or `null` when this tap should print normally (no prior
   *   record, the window has elapsed, or the content has genuinely changed).
   */
  async #checkCooldown(learnerId, agenda) {
    const last = await this.#cooldown.get(learnerId);
    if (!last?.lastAgendaPrintedAt) return null;

    const fingerprint = agendaFingerprint(agenda);
    if (last.contentHash !== fingerprint) return null; // Rule 4: new work bypasses the window entirely.

    const nowMs = this.#clock().getTime();
    const lastMs = Date.parse(last.lastAgendaPrintedAt);
    if (!Number.isFinite(lastMs)) return null; // unreadable timestamp — fail open, print it.

    const elapsedMs = nowMs - lastMs;
    if (elapsedMs >= this.#cooldownMinutes * 60_000) return null; // window has elapsed.

    const sinceMinutes = Math.floor(elapsedMs / 60_000);
    this.#logger.info?.('school.card.agenda-suppressed', {
      learnerId, sinceMinutes, cooldownMinutes: this.#cooldownMinutes,
    });
    // A suppressed tap still BUILT an agenda, and building mints a live access
    // code — the check has to run after the build because the fingerprint needs
    // it. Left alone that quietly inflates the pool of live codes for a receipt
    // that never printed (three such tokens on 2026-08-25). Hand them back.
    for (const token of agenda.mintedTokens ?? []) {
      try {
        // `revoke(token, opts)`'s documented option is `{ at }` — an injected
        // ISO time, because the port reads no clock of its own
        // (ITokenRegistry.mjs:99). Do not invent a `reason` field here.
        await this.#tokens?.revoke?.(token, { at: this.#clock().toISOString() });
        this.#logger.info?.('school.card.suppressed-token-revoked', { learnerId, token });
      } catch (err) {
        this.#logger.warn?.('school.card.token-revoke-failed', { learnerId, token, error: err?.message });
      }
    }
    return {
      status: 'agenda_suppressed',
      learnerId,
      offers: agenda.offers,
      printed: false,
      sinceMinutes,
      cooldownMinutes: this.#cooldownMinutes,
      // Rule 3: a tap that gets nothing at all teaches a child to tap harder —
      // this is the acknowledgement, even though no paper comes out. The
      // caller that broadcasts this to the panel ceremony reads THIS message.
      message: 'You already have today’s agenda — check your desk.',
    };
  }

  /**
   * Record what just printed, so the NEXT tap can tell "the same thing again"
   * from "genuinely new work". Failure here must never turn an already-
   * successful print into an error response back to the child — logged and
   * swallowed, matching `IssueDocument#orphanAllocation`'s "primary success
   * survives a secondary write failing" posture.
   */
  async #armCooldown(learnerId, agenda) {
    try {
      await this.#cooldown.put({
        learnerId,
        lastAgendaPrintedAt: this.#clock().toISOString(),
        contentHash: agendaFingerprint(agenda),
      });
    } catch (err) {
      this.#logger.warn?.('school.card.cooldown-write-failed', { learnerId, error: err?.message });
    }
  }
}

export default ResolvePersonalCard;
