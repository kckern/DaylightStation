/**
 * offeredActions — what the self-service launch card puts in front of a child
 * (self-service access codes design, §2; decisions D3 and D8).
 *
 * A sibling of `nextMove` (`3_applications/school/usecases/offerSession.mjs`),
 * NOT a widening of it (D3). `nextMove` speaks in paper words for the scanner
 * path — "scan your card for the questions" — and the scan path must stay
 * byte-identical. The card speaks in screen words and names the room a child
 * has to walk to, so the two wordings live apart.
 *
 * Pure by construction: it consumes a `ResolveSubjectNext` RESOLUTION, so the
 * session state was already decided upstream and is never re-derived here. No
 * clock, no I/O, no randomness.
 *
 * TWO RULES THIS MODULE EXISTS TO HOLD
 *
 * 1. NEVER print and play in one card (D8). The session event schema forbids
 *    the composite in both orders (`sessionEvents.mjs` TRANSITIONS): printing
 *    first moves `created -> issued`, and `DispatchMedia` dispatches only from
 *    `{created, media_stalled}`, so the video is refused; playing first lands
 *    at `media_dispatched`, which is not in `IssueDocument`'s ISSUABLE, so the
 *    print answers `already_done`. A unit carrying BOTH media and a document
 *    therefore offers the video alone; when the video completes the session
 *    reaches `media_completed` and the recomputed card offers the worksheet.
 *    Making it one tap means new edges on a schema every existing session
 *    replays through — separate work, deliberately not taken here.
 *
 *    The one apparent exception is `outcome_recorded` + `needs_remediation`,
 *    which offers `retry` — a FRESH session via `OpenRemediation`, never a
 *    second print against the graded one.
 *
 * 2. `bankPrintable` is PASSED IN, never decided here. Whether a bank unit has
 *    a sheet to hand out is `IssueDocument.canIssueBank`, which needs
 *    `worksheetInstances`, `assignments` and a bank reader — none of them
 *    reachable from a pure domain module. Guessing it locally with a hardcoded
 *    course name is the duplicated judgement `offerSession.mjs` records
 *    deleting after it drifted (see its `issued`/`reprinted` comment). The
 *    application layer calls `canIssueBank` once and hands the boolean down.
 */

/** The way out. Every card ends with one — the paper path's never-dead-end rule. */
const EXIT = Object.freeze({ kind: 'exit', label: 'Go back' });

const TELL_A_GROWN_UP = 'Tell a grown-up.';

const action = (kind, label, target) => (
  target == null ? { kind, label } : { kind, label, target }
);

const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * The configured media destination, which callers may give either as a bare
 * surface id or as `{ id, label }` when they know the room's name. D4: the
 * button names the destination so the child knows where to walk; with no name
 * to give, it just says what the button does.
 */
const readMediaSurface = (mediaSurface) => {
  if (typeof mediaSurface === 'string') return { id: mediaSurface, label: null };
  return { id: mediaSurface?.id ?? null, label: mediaSurface?.label ?? null };
};

const PLAY_WORDING = Object.freeze({
  first: { withRoom: (room) => `Play in the ${room}`, withoutRoom: 'Play the video' },
  // It stalled and the child walked back to the panel, so the room is still
  // worth naming — they have to walk there again.
  again: { withRoom: (room) => `Play it again in the ${room}`, withoutRoom: 'Play it again' },
});

const playAction = (mediaSurface, { withRoom, withoutRoom }) => {
  const { id, label } = readMediaSurface(mediaSurface);
  return action('play', label ? withRoom(label) : withoutRoom, id);
};

/**
 * The one thing this card offers, or `null` when the session is at a state
 * that asks the child to wait. Mirrors `nextMove`'s ladder state by state,
 * with `bankPrintable` standing where `nextMove` guesses at a course name.
 */
function workAction(resolution, { mediaSurface, bankPrintable }) {
  const unit = resolution.unit ?? {};

  switch (resolution.state?.state) {
    case 'created':
      // `launch` is validated as mutually exclusive with media/document/bank,
      // so reading it first can never shadow one of them — it just keeps the
      // one-shot case at the top of the table, as `nextMove` does.
      if (unit.launch) {
        const hint = unit.launch.labelHint;
        return action('launch', hint ? capitalise(hint) : 'Go do this', unit.launch.surface);
      }
      // Media before document: rule 1 above.
      if (unit.media) return playAction(mediaSurface, PLAY_WORDING.first);
      if (unit.document) return action('print', 'Print your sheet');
      if (unit.bank) {
        return bankPrintable === true
          ? action('print', 'Print your worksheet')
          : action('screen', 'Answer on the screen');
      }
      return null;

    case 'media_completed':
      if (unit.document) return action('print', 'Print the questions');
      if (unit.bank) {
        return bankPrintable === true
          ? action('print', 'Print the questions')
          : action('screen', 'Answer on the screen');
      }
      return null;

    case 'issued':
    case 'reprinted':
      // Always print, deliberately WITHOUT re-reading the unit's composition
      // or `bankPrintable`. A session only reaches this state by having
      // already passed `IssueDocument`'s ISSUABLE gate once, so "is there a
      // sheet for this" was answered YES for this exact unit before this code
      // ran. Re-answering it here is the drift `offerSession.mjs` warns about.
      return action('print', 'Print it again');

    case 'media_stalled':
      return playAction(mediaSurface, PLAY_WORDING.again);

    case 'outcome_recorded':
      // A fresh sheet, NOT a reprint of this session. `IssueDocument`'s
      // ISSUABLE set refuses at `outcome_recorded`, so a `print` here would
      // loop the child through already-done slips until the 4am rollover;
      // remediation is a NEW session with a fresh variant (`OpenRemediation`,
      // the same use case the scan path reaches from this state). The paper
      // path already routes here, so a card that offered only the exit would
      // be a regression against the scan, not a narrowing.
      //
      // `passed` is the other outcome, and it is dead in practice rather than
      // merely unhandled: the planner flips a passed entry to `completed`
      // before this subject is resolved again.
      if (resolution.state?.outcome?.result === 'needs_remediation') {
        return action('retry', 'Print a fresh sheet');
      }
      return null;

    default:
      return null;
  }
}

/**
 * The whole card, decided ONCE. Both exports read this, so "is there a button"
 * and "is there a sentence" can never disagree — an earlier draft answered the
 * second question by re-reading the unit's composition, and a `launch:` unit at
 * `media_completed` came out with no button AND no sentence: a card with
 * nothing on it at all.
 *
 * @returns {{work: object|null, sentence: string|null}}
 */
function buildCard(resolution, { mediaSurface = null, bankPrintable = false } = {}) {
  if (!resolution) return { work: null, sentence: TELL_A_GROWN_UP };

  switch (resolution.kind) {
    case 'served':
      return { work: null, sentence: 'You already did this today.' };
    case 'locked':
      // Verbatim: the remedy is the planner's own wording for why this is shut,
      // and a second phrasing here would be a second answer to drift from.
      return {
        work: null,
        sentence: resolution.remedy ?? resolution.lockedRemedy ?? 'Finish the earlier work first.',
      };
    case 'empty':
    case 'unavailable':
      return { work: null, sentence: TELL_A_GROWN_UP };
    case 'program': {
      // Opens in place on the panel — no room to walk to, so no destination to
      // name beyond the program itself.
      const name = resolution.unit?.title ?? resolution.programId;
      return { work: action('program', `Open ${name}`, resolution.programId), sentence: null };
    }
    case 'move': {
      const work = workAction(resolution, { mediaSurface, bankPrintable });
      return { work, sentence: work ? null : waitingSentence(resolution) };
    }
    default:
      return { work: null, sentence: TELL_A_GROWN_UP };
  }
}

/** Why this card has no button — reached only when `workAction` found nothing. */
function waitingSentence(resolution) {
  switch (resolution.state?.state) {
    case 'media_dispatched':
      // `nextMove` says "finish watching, then scan your card" — paper words.
      // On the panel the child comes back to the keypad instead.
      return 'Finish watching, then type your code again.';
    case 'created':
    case 'media_completed':
      // A composition the ladder has no move for. `nextMove` calls this
      // `nothing` and the scan path answers it with "Nothing to do there yet.
      // Tell a grown-up." The card says the same.
      return TELL_A_GROWN_UP;
    default:
      // Every other state is a wait for the card's purposes: `submitted`,
      // `graded`, `launch_dispatched`, a passed `outcome_recorded`, and the
      // terminal states. Use the move's own label so the child is told
      // something rather than left staring at a bare exit.
      //
      // CAUTION for whoever adds a state here: that label ultimately comes
      // from the reducer's `nextAction`, whose wording is written for PAPER —
      // several of its entries read "Scan your ticket to…". None of those
      // states reach this branch today (each is handled explicitly above), so
      // what lands here is surface-neutral ("A grown-up will check this",
      // "Waiting for the work to be done"). Widening this default without
      // checking `computeNextAction` would put a scanner instruction on a
      // keypad.
      return resolution.move?.label ?? TELL_A_GROWN_UP;
  }
}

/**
 * @param {object} resolution - a `ResolveSubjectNext` resolution
 * @param {object} [options]
 * @param {string|{id: string, label?: string|null}} [options.mediaSurface]
 *   where video goes — `school.yml selfService.mediaSurface`, or a per-unit
 *   `media.surface` override. Give `{id, label}` to have the button name the
 *   room; a bare id leaves it unnamed.
 * @param {boolean} [options.bankPrintable] - the application layer's
 *   `IssueDocument.canIssueBank` answer for this unit. Anything but `true`
 *   sends bank work to the panel's screen.
 * @returns {Array<{kind: string, label: string, target?: string}>}
 *   at most one work action, then always the exit.
 */
export function offeredActions(resolution, options) {
  const { work } = buildCard(resolution, options);
  return work ? [work, EXIT] : [EXIT];
}

/**
 * The sentence printed above the buttons — the whole card when there are no
 * buttons. `null` when the button says it all.
 *
 * @param {object} resolution - a `ResolveSubjectNext` resolution
 * @param {object} [options] - the same options `offeredActions` takes
 * @returns {string|null}
 */
export function cardSentence(resolution, options) {
  return buildCard(resolution, options).sentence;
}

export default offeredActions;
