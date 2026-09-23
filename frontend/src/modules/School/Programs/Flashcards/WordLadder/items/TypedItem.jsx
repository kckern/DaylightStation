import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';
import JamoKeypad from '../JamoKeypad.jsx';
import CuePicture from './CuePicture.jsx';

// Spec §6: the field has had focus this long with no keydown before the
// keypad opens itself. Once per item — a physical keyboard shows up as
// keydowns, and once one has, there is nothing left to detect.
const KEYPAD_AUTO_OPEN_MS = 10_000;

/**
 * Modes:
 *   copy       1.1 copy-type — the Korean is on screen; must match to continue.
 *   dictation  drill step — audio only (the item carries no term); must match
 *              to continue, like copy.
 *   graded     3.3 type-from-cue — judged by the server (meaning, not spelling);
 *              the verdict stays until Next. A graded item with task 1.4 is
 *              the dictation sign-off (ruling 2026-09-23): the term's audio is
 *              the whole prompt (`item.assets.audio`), played on show, with
 *              Listen to replay — judged exactly like 3.3.
 *   practice   drill step "type" — cue only, verdict until Next like graded
 *              (the drill's result has no score: a pass is just "Right!").
 *
 * `pending` (dictation only): the program is HOLDING this result because the
 * step already advanced — a match, or the third miss. That result is final,
 * so it is shown like a graded one ("Right!" / "It's X") with Next, not as a
 * retry prompt. Without `pending`, a dictation miss is a retry.
 *
 * Unjudged practice typing (the drill "type" step, and Write without help —
 * a `typed` item with `graded: false`) also offers "Show me": it submits an
 * empty answer, which the server scores as a miss and answers with the word.
 */
export default function TypedItem({ item, mode, langs, resolveAssetUrl, onRespond, result = null, onContinue, busy = false, stageRef = null, pending = false, onLayout }) {
  const [value, setValue] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const input = useRef(null);
  const word = item.word;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  const dictation = mode === 'dictation';
  // Graded dictation (the 1.4 sign-off): heard like a drill dictation, judged like 3.3.
  const heardSignOff = mode === 'graded' && item.task === '1.4';
  const hearsTerm = dictation || heardSignOff;
  const termAudioId = hearsTerm ? item.assets?.audio : word?.media?.audio;
  const termAudio = termAudioId ? resolveAssetUrl(termAudioId) : null;
  // graded + practice: cue prompt, verdict held until Next. copy + dictation: retry until it matches.
  const graded = mode === 'graded' || mode === 'practice' || (dictation && pending);
  const canShowMe = mode === 'practice' || (mode === 'graded' && item.graded === false);
  // Answered = a final verdict is on screen. Busy only disables the field: the
  // keypad and its toggle stay mounted through a submit (no flicker, no lost
  // open state), and go only once there is nothing left to type.
  const answered = graded && Boolean(result);
  const fieldDisabled = busy || answered;

  // Auto-open bookkeeping. Refs, not state: read inside a timer callback and
  // a document listener, neither of which should re-run when the value they
  // read changes. `fieldDisabledRef` and `itemIdRef` are updated on every
  // render (plain assignment — cheap, and always current by the time an
  // async callback reads them, well ahead of any real timer firing) so the
  // 10 s timer sees whatever is true AT FIRE TIME, not what was true when it
  // was scheduled: `busy`/`result` change without `item.id` changing, so the
  // effect that scheduled the timer never re-runs to pick them up itself.
  const keypadOpenRef = useRef(false);
  const keypadUsedRef = useRef(false); // auto-open attempted (fired or cancelled) for this item
  const autoTimerRef = useRef(null);
  const fieldDisabledRef = useRef(fieldDisabled);
  const itemIdRef = useRef(item.id);
  useEffect(() => { keypadOpenRef.current = keypadOpen; }, [keypadOpen]);
  fieldDisabledRef.current = fieldDisabled;
  itemIdRef.current = item.id;

  useEffect(() => {
    const thisItemId = item.id;
    setValue('');
    input.current?.focus();
    if ((mode === 'copy' || hearsTerm) && termAudio) playClip(termAudio, 'term');
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio, 'gloss');
    // Keypad: closed and re-armed to auto-open once per item.
    setKeypadOpen(false);
    keypadUsedRef.current = false;
    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      if (keypadUsedRef.current) return;
      keypadUsedRef.current = true;
      // Skip — never reschedule — if the item has since moved on, or the
      // field is mid-submit / already answered. Opening the keypad (and
      // stealing focus) over a "Checking…" state or a result already on
      // screen would be a surprise, not a convenience.
      if (itemIdRef.current !== thisItemId || fieldDisabledRef.current) return;
      setKeypadOpen(true);
      // Mirrors toggleKeypad: the child may have tapped Hear it or another
      // control in the idle window, and the keypad is useless if the field
      // that lost focus never gets it back.
      input.current?.focus();
      wordLadderLog.keypadToggled({ auto: true, open: true });
    }, KEYPAD_AUTO_OPEN_MS);
    return () => clearTimeout(autoTimerRef.current);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A copy mismatch starts the retry from an empty field. Never select-all: the
  // in-page composer inserts at the caret, so a selection would not be replaced.
  useEffect(() => {
    if (result && !graded && result.correct === false) { setValue(''); input.current?.focus(); }
  }, [result, graded]);

  /**
   * "Closes on the first physical keydown" (spec §6). This has to be a
   * `document` capture listener, not the field's own `onKeyDown`: in Korean
   * mode `HangulTypingProvider` consumes a real jamo key and calls
   * `stopPropagation()` on ITS OWN document-capture listener, which — since
   * that listener is mounted once at the top of School, long before this
   * item exists — halts propagation before it would ever reach a listener on
   * the input itself. Two listeners on the SAME node (`document`) are not
   * subject to that halt; only listeners further down the tree are. So this
   * effect adds its own `document` capture listener rather than relying on
   * bubbling to the field, and identifies "was this our field" by
   * `event.target`, which is fixed at dispatch time regardless of which node
   * is currently running listeners.
   */
  useEffect(() => {
    const onPhysicalKeydown = (event) => {
      if (event.target !== input.current) return;
      clearTimeout(autoTimerRef.current);
      keypadUsedRef.current = true;
      if (keypadOpenRef.current) {
        setKeypadOpen(false);
        wordLadderLog.keypadToggled({ auto: true, open: false });
      }
    };
    document.addEventListener('keydown', onPhysicalKeydown, true);
    return () => document.removeEventListener('keydown', onPhysicalKeydown, true);
  }, []);

  const toggleKeypad = () => {
    clearTimeout(autoTimerRef.current);
    keypadUsedRef.current = true;
    const next = !keypadOpen;
    setKeypadOpen(next);
    wordLadderLog.keypadToggled({ auto: false, open: next });
    input.current?.focus();
  };

  const submit = () => {
    if (busy || !value.trim()) return;
    onRespond({ typed: value });
    if (graded) { input.current?.blur(); stageRef?.current?.focus(); }
  };
  const showMe = () => {
    if (busy || answered) return;
    onRespond({ typed: '' });
    input.current?.blur(); stageRef?.current?.focus();
  };
  useWordLadderKeys(result && graded ? { ' ': onContinue, enter: onContinue } : {}, { enabled: Boolean(result) && graded });
  const keypadShowing = keypadOpen && !answered;
  return (
    <section
      className={`wl-item wl-typed${keypadShowing ? ' wl-typed--keypad' : ''}`}
      aria-label={hearsTerm ? 'Write what you hear' : graded ? 'Type the word' : 'Copy the word'}
    >
      <div className="wl-prompt">
        {mode === 'copy' && <FitText role="term" text={word?.term ?? ''} lang={langs.term} onFit={onLayout} />}
        {hearsTerm && !answered && <TouchButton variant="secondary" onClick={() => termAudio && playClip(termAudio, 'term')}><Icon name="volume" /> Listen</TouchButton>}
        {graded && item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {graded && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {graded && item.cue?.type === 'audio' && <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio, 'gloss')}><Icon name="volume" /> Listen</TouchButton>}
      </div>
      <input
        ref={input}
        className="wl-typed__field"
        type="text"
        lang={langs.term}
        data-ime-lang={langs.term}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={fieldDisabled}
        aria-label="Your answer"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <div className="wl-controls">
        {mode === 'copy' && termAudio && <TouchButton variant="secondary" onClick={() => playClip(termAudio, 'term')}><Icon name="volume" /> Hear it</TouchButton>}
        {!answered && (
          <TouchButton variant="secondary" disabled={busy} aria-pressed={keypadOpen} onClick={toggleKeypad}>
            <Icon name="writing" /> Keypad
          </TouchButton>
        )}
        {/* A copy mismatch is a retry, not a terminal result — only a GRADED
            result hides the submit button; copy mode keeps it for the retry. */}
        {(!result || (!graded && result?.correct === false)) && (
          <>
            {canShowMe && <TouchButton variant="secondary" disabled={busy} onClick={showMe}>Show me</TouchButton>}
            <TouchButton variant="primary" keyHint="Enter" disabled={busy || !value.trim()} onClick={submit}>{busy && graded ? 'Checking…' : 'Enter'}</TouchButton>
          </>
        )}
        {!graded && result?.correct === false && (
          <p className="wl-verdict" role="status">
            {!dictation && 'Try again — copy it exactly.'}
            {/* Dictation reveals the term only after the second miss (the server
                sends `answer` then) — from there the step is a copy. */}
            {dictation && !result.answer && 'Not quite — listen again and have another go.'}
            {dictation && result.answer && <>It&apos;s <span lang={langs.term}>{result.answer}</span> — type it</>}
          </p>
        )}
        {graded && result && (
          <p className="wl-verdict" role="status">
            {result.correct && (result.score == null || result.score === 10) && 'Right!'}
            {result.correct && result.score != null && result.score < 10 && <>Got it! Here&apos;s the spelling: <span lang={langs.term}>{result.answer}</span></>}
            {!result.correct && <>It&apos;s <span lang={langs.term}>{result.answer}</span></>}
          </p>
        )}
        {graded && result && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
      <JamoKeypad
        open={keypadShowing}
        onToggle={toggleKeypad}
        onSubmit={submit}
        focusTarget={() => input.current?.focus()}
      />
    </section>
  );
}
