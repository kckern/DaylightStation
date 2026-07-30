/**
 * offerSession — the session-offer helper shared by `BuildAgenda` (and, from
 * Task 11, `ResolveScanAction`'s retry path): given a plan entry and a unit,
 * make sure a work session exists for it, then decide what acting on that
 * entry means RIGHT NOW.
 *
 * Extracted from `BuildAgenda.mjs` (Task 7 of the school-agenda-v2 plan) as a
 * pure refactor — no behavior change. `BuildAgenda` calls `ensureSession` then
 * `nextMove` and mints its per-unit token exactly as it did inline before.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

/**
 * Make sure this unit has a session: reuse an open one, or open a fresh one.
 * Re-scanning the card must never create a second session for the same unit —
 * that is what makes `select_unit` idempotent (spec §6.3).
 *
 * @param {object} args
 * @param {{unitId: string, sessionId?: string|null}} args.entry - the plan entry
 * @param {string} args.learnerId
 * @param {string} args.nowIso
 * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} args.sessions
 * @param {() => string} args.newSessionId
 * @returns {Promise<{sessionId: string, state: object, created: boolean}>}
 *   `state` is the `reduceSession` result for the session as of this call.
 */
export async function ensureSession({ entry, learnerId, nowIso, sessions, newSessionId }) {
  let sessionId = entry.sessionId;
  let created = false;
  let state;

  if (sessionId) {
    state = reduceSession(await sessions.readEvents(sessionId));
  } else {
    sessionId = newSessionId();
    const { errors, event } = createEvent({
      type: 'created', at: nowIso, sessionId, learnerId, unitId: entry.unitId,
    });
    if (errors.length) throw new Error(`BuildAgenda: could not open a session: ${errors.join('; ')}`);
    await sessions.appendEvent(sessionId, event);
    state = reduceSession([{ ...event, seq: 1 }]);
    created = true;
  }

  return { sessionId, state, created };
}

/**
 * The state-and-composition decision: what acting on this entry means NOW.
 * One table, read top to bottom — `agendaLabel` (below) is derived from it
 * rather than duplicating it, so there is exactly one place that decides
 * wording.
 *
 * `kind` is metadata for callers that route on the shape of the move (Task 11
 * onward); `BuildAgenda` itself only consumes `tokenClass` and `label`, same
 * as it always has.
 *
 * @param {object} unit - the unit's composition (`media`/`document`/`bank`)
 * @param {object} state - a `reduceSession` result
 * @returns {{kind: string, tokenClass: string|null, label: string}}
 */
export function nextMove(unit, state) {
  const nextAction = state.nextAction;
  const reducerTokenClass = nextAction?.tokenClass ?? null;
  const reducerLabel = nextAction?.label;

  switch (state.state) {
    case 'created':
      // `created` is the one state the reducer cannot label or class for us:
      // what starting MEANS depends on the unit's composition, and the
      // reducer never sees units. Starting is always a selection scan.
      if (unit.media) return { kind: 'play', tokenClass: 'select_unit', label: 'watch or listen' };
      if (unit.document) return { kind: 'print', tokenClass: 'select_unit', label: 'print your sheet' };
      if (unit.bank) return { kind: 'screen', tokenClass: 'select_unit', label: 'answer on the screen' };
      // A unit with none of media/document/bank still gets a `select_unit`
      // token — the scan must never dead-end. Scanning it lands in
      // `ResolveScanAction#start`'s empty branch ("Nothing to do there yet.
      // Tell a grown-up."), which exists precisely for this case.
      return { kind: 'nothing', tokenClass: 'select_unit', label: 'start this' };

    case 'media_completed':
      // The reducer says `issue_document` here because it never sees units. A
      // unit whose questions live in a BANK has no sheet to print, and
      // offering one sends the child to a scan that can only answer "there is
      // no sheet" — so the label (only) is composition-aware; the token class
      // still rides the reducer's, exactly as before this extraction.
      if (unit.document) return { kind: 'print', tokenClass: reducerTokenClass, label: 'print the questions' };
      if (unit.bank) return { kind: 'screen', tokenClass: reducerTokenClass, label: 'answer on the screen' };
      return { kind: 'wait', tokenClass: reducerTokenClass, label: 'carry on' };

    case 'media_stalled':
      return { kind: 'play', tokenClass: reducerTokenClass, label: 'start it again' };

    case 'media_dispatched':
      return { kind: 'wait', tokenClass: reducerTokenClass, label: 'finish watching, then scan your card' };

    case 'outcome_recorded':
      // This state is only ever offered here for `needs_remediation` — a
      // `passed` outcome flips the plan entry to `completed` (planner.mjs)
      // before BuildAgenda calls this again, so that branch is dead in
      // practice, not merely unhandled. NEVER route this to `print`:
      // `IssueDocument`'s ISSUABLE set is `created|media_completed|issued|
      // reprinted` and refuses at `outcome_recorded`, so a `print` token here
      // would loop the child through already-done slips until 4am. The retry
      // is a NEW session with a fresh variant (`OpenRemediation`, dispatched
      // via `ResolveScanAction.#retry`), not a reprint of this one.
      if (state.outcome?.result === 'needs_remediation') {
        return { kind: 'retry', tokenClass: 'remediation', label: 'try again with a fresh sheet' };
      }
      return { kind: 'wait', tokenClass: reducerTokenClass, label: reducerLabel || 'carry on' };

    default:
      return { kind: 'wait', tokenClass: reducerTokenClass, label: reducerLabel || 'carry on' };
  }
}

/**
 * What the child is being invited to DO, in their words. A thin wrapper over
 * `nextMove` — kept for callers that just want the wording without the rest
 * of the move.
 *
 * @param {object} unit
 * @param {object} state - a `reduceSession` result
 * @param {string} [fallback]
 */
export function agendaLabel(unit, state, fallback) {
  return nextMove(unit, state).label ?? fallback;
}
