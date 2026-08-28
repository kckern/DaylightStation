/**
 * CheckpointQuizOverlay — the thing a child actually sees when a lesson stops.
 *
 * A gated media lesson pauses at an authored position and this is what the
 * paused picture is replaced by: one question, from the unit's own bank,
 * rendered by the SAME item components the touch-panel quiz uses
 * (`quiz/items/*`), with a focus ring laid over the top so a remote or a
 * gamepad can drive them. Nothing is re-implemented — the ring finds the item's
 * buttons in the DOM and clicks them, so a fix to `MultipleChoiceItem` is a fix
 * here too.
 *
 * ## WHO IS READING THIS
 *
 * A child on a sofa, ~3 m from a 960x540 CSS viewport, holding a remote. They
 * may be five and unable to read. They have just been interrupted mid-video,
 * which is annoying by construction — so the card is one question, one ring,
 * and a way to go back and watch the bit again, at sizes that survive the
 * distance. Everything else is chrome the lesson does not need.
 *
 * ## THE OVERLAY OWNS NO EXIT
 *
 * `escape` at a live question does NOTHING. That rule lives in
 * `useMediaLessonSession.escape()` — the single authority — and this component
 * neither duplicates nor contradicts it: it forwards every escape to `onEscape`
 * and reads the boolean back. `false` means the hook refused (there is no
 * notice), and the only thing that happens here is a line telling the child
 * what WILL work, because a gate that answers a button press with total
 * silence teaches a child the screen is broken. There is deliberately no
 * `onExit` prop, no timeout, and no "are you sure" — a second way out is a hole
 * in the gate, and every hole in this gate is a lesson skipped.
 *
 * ## THREE DESIGN DECISIONS (delegated at task time)
 *
 * **1. Initial focus is the FIRST ANSWER; after a first miss it returns there;
 * after a SECOND miss it moves to "watch it again".** Focusing the escape on
 * arrival would tell a child the expected move is to leave, and a pre-literate
 * child who pattern-matches "press OK on the highlighted thing" would take the
 * rewind every time and never attempt the question. After ONE wrong answer the
 * ring goes back to the top of the (reshuffled) answers: one miss is a normal
 * guess and the child should still be answering. After TWO the ring moves onto
 * "watch it again" — two misses on a four-option question is the point where
 * more guessing becomes brute force, and this feature exists precisely so that
 * the child self-selects remediation instead. It is a NUDGE, not a gate: the
 * answers are one d-pad press away and nothing is disabled.
 *
 * **2. The answers reshuffle after a wrong answer; "watch it again" NEVER
 * moves.** Reshuffling is what stops a four-option question falling to
 * position-memory — "not the second one, not the fourth one" — and it is the
 * reason retry-until-correct is not simply a slower way to guess. Its COST is
 * real and lands on exactly the child least able to pay it: a pre-literate
 * child navigating by position loses their record of what they already tried,
 * so their expected number of tries goes back up to a blind draw each round,
 * and the card visibly rearranges itself under them after every miss. Three
 * things bound that cost — the option COUNT and layout never change, the ring
 * always restarts at the top, and the escape hatch is structurally last and
 * excluded from the shuffle. That last one is the load-bearing half: if the one
 * control a non-reader must be able to find by muscle memory moved as well,
 * they would have no reliable escape at all, and "self-select remediation"
 * would collapse straight back into brute-forcing the options. A transport
 * failure does NOT reshuffle (see `submit`): "try that again" must not move the
 * thing it is asking the child to try again.
 *
 * **3. An item a d-pad cannot answer still gets an escape, and it is focused.**
 * Short-answer and cloze want a keyboard the living room does not have;
 * matching wants pointer drags. None of them has an option list to append to,
 * so the rewind control lives in the OVERLAY's own footer rather than inside
 * the item, and it is therefore present for every type. For those types the
 * ring opens ON it, because the alternative is a child staring at a text field
 * they cannot type into with the gate holding the video. The item's own `Check`
 * button stays in the ring so an attached keyboard still works, and the case is
 * logged (`school.lesson.checkpoint.no-dpad-input`) because authoring one of
 * these onto a TV lesson is a curriculum bug this screen cannot fix.
 *
 * ## WHAT THIS COMPONENT MUST BE GIVEN
 *
 * `checkpoint.items` must hold ITEM BODIES (`{id, type, prompt, choices}`), not
 * the bare item ids the authored `checkpoints:` block carries.
 *
 * When this component was written nothing served those bodies —
 * `DispatchMedia.publicCheckpoints` strips items to `{id, at}`, and grading
 * returns no prompt — so every checkpoint would have rendered the fault card.
 * `ReadLessonSnapshot` (Task 9) closed that gap: `GET /lesson/:sessionId` now
 * ships a per-type PUBLIC PROJECTION inline on `checkpoints[].items`, picking
 * `{id, type, prompt, choices}` and withholding `answer`/`accept`/`expected`.
 * Inline rather than fetched-on-demand deliberately: a by-id fetch would happen
 * at the moment the gate has already stopped the picture, and a failed request
 * there strands a child in front of a frozen frame.
 *
 * An unresolvable item still arrives as a bare id STRING, and anything
 * unrenderable falls to an explicit fault state whose only control is
 * "watch it again" — visible to a child, and greppable in the log store as
 * `school.lesson.checkpoint.unrenderable`.
 *
 * ## MOUNTING (for the widget, Task 15)
 *
 * Mount while `view === 'checkpoint'` OR (`view === 'celebrating'` AND
 * `celebration === 'checkpoint'`). The ✓ beat is the hook's — this component
 * shows the tick and then waits to be unmounted; it starts no timer of its own.
 * Note also that `ActionBus.emit` BROADCASTS: subscribing to `escape` here does
 * not consume it, so nothing else mounted on this screen may act on `escape`
 * while a checkpoint is up, or the gate leaks through that other handler.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MultipleChoiceItem from '../quiz/items/MultipleChoiceItem.jsx';
import ShortAnswerItem from '../quiz/items/ShortAnswerItem.jsx';
import ClozeItem from '../quiz/items/ClozeItem.jsx';
import MatchingItem from '../quiz/items/MatchingItem.jsx';
import { useScreenAction } from '../../../screen-framework/input/useScreenAction.js';
import getLogger from '../../../lib/logging/Logger.js';
import './CheckpointQuizOverlay.scss';

/** The same table `QuizRunner` keys on — reused, never re-implemented. */
const ITEM_COMPONENTS = {
  multiple_choice: MultipleChoiceItem,
  short_answer: ShortAnswerItem,
  cloze: ClozeItem,
  matching: MatchingItem,
};

/**
 * The only type a d-pad can actually ANSWER. The others render (a keyboard or a
 * pointer may exist) but the ring opens on the escape rather than on a control
 * the remote cannot operate. See decision 3.
 */
const DPAD_ANSWERABLE = new Set(['multiple_choice']);

/**
 * How many wrong answers before the ring moves onto "watch it again".
 * TWO — see decision 1. One miss is a guess; two is where guessing turns into
 * brute force and the remediation should be under the child's thumb.
 *
 * Module-private, like `reshuffle` below: a `.jsx` that exports anything but
 * its component loses Fast Refresh (`react-refresh/only-export-components`),
 * and neither is worth a second file — the tests reach both through behaviour.
 */
const REWIND_NUDGE_AFTER = 2;

/** Everything the ring can reach, in DOM ORDER. The rewind is always last. */
const RING_SELECTOR = '.school-item__choice, .school-item__check, [data-checkpoint-rewind]';

/**
 * Fisher-Yates, with one extra rule: NEVER hand back the order it was given.
 * A "reshuffle" that visibly changes nothing reads to a child as the screen
 * ignoring them, and is indistinguishable from the reshuffle being broken —
 * and on a four-option question a plain shuffle reproduces its input about one
 * time in twenty-four, so this is a case that happens, not a theoretical one.
 * Callers must therefore pass the order CURRENTLY ON SCREEN, not the authored
 * one: shuffling the authored list twice is what makes the guarantee vacuous.
 */
function reshuffle(choices, rand = Math.random) {
  const out = [...choices];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((c, i) => c === choices[i])) out.push(out.shift());
  return out;
}

/** An item body we can actually put in front of a child, or null. */
const renderableItem = (entry) => {
  if (!entry || typeof entry !== 'object') return null;               // a bare id string
  if (!ITEM_COMPONENTS[entry.type]) return null;
  if (typeof entry.id !== 'string' || !entry.id) return null;
  return entry;
};

/**
 * @param {object} props
 * @param {{id: string, at: number, items: Array<object|string>}|null} props.checkpoint
 *   the DUE checkpoint, with ITEM BODIES in `items` (see the header's contract
 *   note). Falsy renders nothing.
 * @param {(checkpointId: string, itemId: string, given: *) => Promise<object>} props.onAnswer
 *   `useMediaLessonSession.answer`. Its reply decides everything below.
 * @param {() => void} props.onRewind `useMediaLessonSession.chooseRewind`.
 * @param {() => boolean} props.onEscape `useMediaLessonSession.escape` — TRUE
 *   when it handled the press (there was a notice), FALSE when the gate refused.
 * @param {{tone: string, title: string, detail: string|null}|null} [props.notice]
 * @param {string|null} [props.learnerName] shown small, so a sibling who
 *   wandered past can see whose lesson is being graded.
 */
export default function CheckpointQuizOverlay({
  checkpoint,
  onAnswer,
  onRewind,
  onEscape,
  notice = null,
  learnerName = null,
}) {
  const logger = useMemo(
    () => getLogger().child({ app: 'school', component: 'checkpoint-quiz-overlay' }),
    [],
  );

  const [itemIndex, setItemIndex] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  /** Bumped on every completed submission — REMOUNTS the item component. The
   *  existing items latch `submittedRef` on the first tap and only clear it
   *  when `item.id` changes, so without a fresh key a re-asked question is
   *  permanently dead: the child taps and nothing at all happens. */
  const [nonce, setNonce] = useState(0);
  /** Bumped only on a WRONG answer — a transport failure must not rearrange
   *  the options under "try the answer again" (decision 2). */
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [phase, setPhase] = useState('asking');       // asking | cleared
  const [escapeBlocked, setEscapeBlocked] = useState(false);

  const rootRef = useRef(null);
  const inFlightRef = useRef(false);
  const focusIndexRef = useRef(focusIndex);
  focusIndexRef.current = focusIndex;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const entries = Array.isArray(checkpoint?.items) ? checkpoint.items : [];
  const total = entries.length;
  const item = renderableItem(entries[Math.min(itemIndex, Math.max(total - 1, 0))]);
  const ItemComponent = item ? ITEM_COMPONENTS[item.type] : null;
  const dpadAnswerable = Boolean(item) && DPAD_ANSWERABLE.has(item.type);

  // The presented order. Re-derived per item and per WRONG answer, each time
  // from the order CURRENTLY ON SCREEN — reshuffling the authored list again
  // would let two consecutive rounds come out identical, which is the whole
  // thing the shuffle exists to prevent. The rewind control is not in here at
  // all, which is what keeps it structurally last (decision 2).
  const orderRef = useRef({ itemId: null, order: null });
  const choices = useMemo(() => {
    if (!item || !Array.isArray(item.choices)) return null;
    const base = orderRef.current.itemId === item.id && orderRef.current.order
      ? orderRef.current.order
      : item.choices;
    const next = reshuffle(base);
    orderRef.current = { itemId: item.id, order: next };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shuffleSeed IS the input
  }, [item?.id, shuffleSeed]);
  const presented = useMemo(
    () => (choices ? { ...item, choices } : item),
    [item, choices],
  );

  const ringNodes = useCallback(() => {
    const root = rootRef.current;
    if (!root) return [];
    return [...root.querySelectorAll(RING_SELECTOR)].filter((n) => !n.disabled);
  }, []);

  // Where the ring opens on a fresh question. See decisions 1 and 3.
  const openingIndex = useCallback(() => {
    if (dpadAnswerable) return 0;
    const nodes = ringNodes();
    return nodes.length ? nodes.length - 1 : 0;         // the rewind, always last
  }, [dpadAnswerable, ringNodes]);

  // Apply the ring to the DOM. `data-focused` is what the stylesheet paints —
  // the item components are foreign markup and must not need a prop for this.
  useEffect(() => {
    if (phase !== 'asking') return;
    const nodes = ringNodes();
    if (!nodes.length) return;
    const at = Math.min(Math.max(focusIndex, 0), nodes.length - 1);
    nodes.forEach((node, i) => {
      if (i === at) node.setAttribute('data-focused', 'true');
      else node.removeAttribute('data-focused');
    });
    nodes[at].focus();
  }, [focusIndex, nonce, itemIndex, phase, ringNodes]);

  // A fresh question (mount, or the next item) opens the ring where decision 1
  // and 3 say it opens. Kept apart from the effect above so a `navigate` in
  // between is never overwritten.
  useEffect(() => {
    setFocusIndex(openingIndex());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot per item
  }, [item?.id]);

  useEffect(() => {
    if (!checkpoint) return;
    logger.info('school.lesson.checkpoint.overlay-open', {
      checkpointId: checkpoint.id ?? null, at: checkpoint.at ?? null,
      items: total, itemType: item?.type ?? null, learner: learnerName ?? null,
    });
    if (!item) {
      logger.error('school.lesson.checkpoint.unrenderable', {
        checkpointId: checkpoint.id ?? null,
        // The authored block carries item IDS; the snapshot must carry BODIES.
        got: entries.map((e) => (typeof e === 'string' ? e : e?.type ?? typeof e)),
      });
    } else if (!dpadAnswerable) {
      logger.warn('school.lesson.checkpoint.no-dpad-input', {
        checkpointId: checkpoint.id ?? null, itemId: item.id, itemType: item.type,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per checkpoint/item
  }, [checkpoint?.id, item?.id]);

  /**
   * One graded answer. The gate opens in exactly one place — a reply carrying
   * `checkpointCleared` — and every other outcome re-asks. Nothing here is
   * allowed to conclude "that was probably right".
   */
  const submit = useCallback(async (given) => {
    if (phaseRef.current !== 'asking' || !item || !checkpoint) return;
    // A remote's double-click must not spend two attempts. The session hook
    // guards this too; the guard is here as well because the reply shape below
    // (`in-flight`) would otherwise be mistaken for a wrong answer and would
    // reshuffle the card under the child's own confirm.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setEscapeBlocked(false);
    let reply = null;
    try {
      reply = await onAnswer?.(checkpoint.id, item.id, given);
    } finally {
      inFlightRef.current = false;
    }

    if (reply?.checkpointCleared) {
      logger.info('school.lesson.checkpoint.overlay-cleared', {
        checkpointId: checkpoint.id, itemId: item.id, attempts: reply.attempts ?? null,
      });
      setPhase('cleared');
      return;
    }
    setNonce((n) => n + 1);                             // remount: answerable again

    if (reply?.ok && reply.correct === true) {
      const next = itemIndex + 1;
      if (next < total) {
        logger.info('school.lesson.checkpoint.overlay-next-item', {
          checkpointId: checkpoint.id, itemId: item.id, next,
        });
        setItemIndex(next);
      } else {
        // Right, not cleared, and nothing left to ask: the server's in-memory
        // half-answered progress is behind what we think we answered (a TTL
        // sweep, a restart). Its own documented recovery is to re-ask the
        // checkpoint from the top, so do exactly that rather than sit on a
        // question that cannot clear.
        logger.warn('school.lesson.checkpoint.overlay-restart', {
          checkpointId: checkpoint.id, itemId: item.id, items: total,
        });
        setItemIndex(0);
      }
      setWrongCount(0);
      setFocusIndex(dpadAnswerable ? 0 : Math.max(ringNodes().length - 1, 0));
      return;
    }

    if (reply?.correct === false) {
      const wrong = wrongCount + 1;
      logger.info('school.lesson.checkpoint.overlay-wrong', {
        checkpointId: checkpoint.id, itemId: item.id, wrong,
      });
      setWrongCount(wrong);
      setShuffleSeed((s) => s + 1);                     // decision 2
      // Decision 1: back to the answers on the first miss, onto the escape on
      // the second. Resolved against the ring as it will be AFTER this render,
      // whose length does not change — only the order does.
      setFocusIndex(wrong >= REWIND_NUDGE_AFTER ? Math.max(ringNodes().length - 1, 0) : 0);
      return;
    }

    // Refused, unreachable, or ungradable. NOT a wrong answer: the child may
    // have been right and nothing recorded it, so it costs no attempt, moves no
    // option, and never counts toward the rewind nudge. The session hook has
    // already raised the notice that says what to do.
    logger.warn('school.lesson.checkpoint.overlay-unrecorded', {
      checkpointId: checkpoint.id, itemId: item.id,
      status: reply?.status ?? null, reason: reply?.reason ?? reply?.status ?? null,
    });
    setFocusIndex(dpadAnswerable ? 0 : Math.max(ringNodes().length - 1, 0));
  }, [checkpoint, dpadAnswerable, item, itemIndex, logger, onAnswer, ringNodes, total, wrongCount]);

  const takeRewind = useCallback(() => {
    if (phaseRef.current !== 'asking') return;
    logger.info('school.lesson.checkpoint.overlay-rewind', {
      checkpointId: checkpoint?.id ?? null, itemId: item?.id ?? null, afterWrong: wrongCount,
    });
    setEscapeBlocked(false);
    onRewind?.();
  }, [checkpoint, item, logger, onRewind, wrongCount]);

  // ── input: one bus, so a remote and a gamepad are the same code path ─────

  const handleNavigate = useCallback((payload) => {
    if (phaseRef.current !== 'asking') return;
    const direction = payload?.direction;
    // up/left and down/right BOTH move the single vertical ring: a child
    // pushing a stick sideways at a list of answers means "next one", and a
    // dead direction on a remote reads as a broken screen.
    const delta = direction === 'up' || direction === 'left' ? -1
      : direction === 'down' || direction === 'right' ? 1 : 0;
    if (!delta) return;
    const count = ringNodes().length;
    if (!count) return;
    // Wraps, deliberately: a dead end at either end of a five-item ring is a
    // child holding a button at a screen that has stopped responding.
    setFocusIndex((i) => (((i + delta) % count) + count) % count);
  }, [ringNodes]);

  const handleSelect = useCallback(() => {
    if (phaseRef.current !== 'asking') return;
    const nodes = ringNodes();
    const node = nodes[Math.min(Math.max(focusIndexRef.current, 0), nodes.length - 1)];
    if (!node) return;
    // Click the real control. On a multiple choice that is arm-then-confirm —
    // the item component's own two-step, kept rather than bypassed, so a child
    // mashing OK while the ring wanders cannot fire an answer they never chose.
    node.click();
  }, [ringNodes]);

  const handleEscape = useCallback(() => {
    // THE GATE. This component has no exit of its own; `onEscape` is
    // `useMediaLessonSession.escape`, which refuses at a live question and
    // exits only at a notice. `false` means refused.
    const handled = onEscape?.() === true;
    if (handled) return;
    logger.info('school.lesson.checkpoint.overlay-escape-blocked', {
      checkpointId: checkpoint?.id ?? null, phase: phaseRef.current,
    });
    setEscapeBlocked(true);
  }, [checkpoint, logger, onEscape]);

  useScreenAction('navigate', handleNavigate);
  useScreenAction('select', handleSelect);
  useScreenAction('escape', phase === 'asking' ? handleEscape : null);

  if (!checkpoint) return null;

  if (phase === 'cleared') {
    return (
      <div className="checkpoint-quiz checkpoint-quiz--cleared" data-testid="checkpoint-quiz">
        <div className="checkpoint-quiz__card">
          <p className="checkpoint-quiz__tick" data-testid="checkpoint-cleared" aria-live="polite">
            <span aria-hidden="true">✓</span> Got it
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkpoint-quiz" data-testid="checkpoint-quiz" ref={rootRef}>
      <div className="checkpoint-quiz__card">
        <div className="checkpoint-quiz__head">
          <span className="checkpoint-quiz__eyebrow">Quick question</span>
          {total > 1 && (
            <span className="checkpoint-quiz__progress" data-testid="checkpoint-progress">
              {Math.min(itemIndex + 1, total)} of {total}
            </span>
          )}
          {learnerName && <span className="checkpoint-quiz__who">{learnerName}</span>}
        </div>

        {notice && (
          <p className={`checkpoint-quiz__notice checkpoint-quiz__notice--${notice.tone ?? 'warn'}`}
            data-testid="checkpoint-notice" aria-live="assertive">
            <strong>{notice.title}</strong>
            {notice.detail ? ` ${notice.detail}` : ''}
          </p>
        )}

        {item ? (
          <>
            <ItemComponent key={`${item.id}:${nonce}`} item={presented} onSubmit={submit} verdict={null} />
            {dpadAnswerable && (
              <p className="checkpoint-quiz__hint">Press OK to pick, then OK again to answer.</p>
            )}
          </>
        ) : (
          <div className="checkpoint-quiz__fault" data-testid="checkpoint-fault">
            <p className="checkpoint-quiz__prompt">This question didn&rsquo;t load.</p>
            <p className="checkpoint-quiz__hint">Watch that part again, and tell a grown-up.</p>
          </div>
        )}

        {/* The escape from a question you cannot answer. Structurally last and
            never reshuffled (decision 2), present for every item type
            (decision 3), and ONE press — a child who is stuck must not have to
            work out a two-step gesture to get help. */}
        <div className="checkpoint-quiz__rewind-zone">
          <button
            type="button"
            className="checkpoint-quiz__rewind"
            data-checkpoint-rewind="true"
            data-testid="checkpoint-rewind"
            onClick={takeRewind}
          >
            <span className="checkpoint-quiz__rewind-glyph" aria-hidden="true">↺</span>
            Watch that part again
          </button>
        </div>

        {escapeBlocked && (
          <p className="checkpoint-quiz__blocked" data-testid="checkpoint-escape-blocked" aria-live="polite">
            Answer the question, or choose &ldquo;Watch that part again&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
