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
 * 1.1 copy-type (the Korean is on screen; must match to continue) and 3.3
 * type-from-cue (graded by the server's judge — meaning, not spelling).
 */
export default function TypedItem({ item, mode, langs, resolveAssetUrl, onRespond, result = null, onContinue, busy = false, stageRef = null }) {
  const [value, setValue] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const input = useRef(null);
  const word = item.word;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  const termAudio = word?.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  const graded = mode === 'graded';
  const fieldDisabled = busy || (graded && Boolean(result));

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
    if (mode === 'copy' && termAudio) playClip(termAudio);
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio);
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
    if (result && mode === 'copy' && result.correct === false) { setValue(''); input.current?.focus(); }
  }, [result, mode]);

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
    if (mode === 'graded') { input.current?.blur(); stageRef?.current?.focus(); }
  };
  useWordLadderKeys(result && graded ? { ' ': onContinue, enter: onContinue } : {}, { enabled: Boolean(result) && graded });
  const keypadShowing = keypadOpen && !fieldDisabled;
  return (
    <section
      className={`wl-item wl-typed${keypadShowing ? ' wl-typed--keypad' : ''}`}
      aria-label={graded ? 'Type the word' : 'Copy the word'}
    >
      <div className="wl-prompt">
        {!graded && <FitText role="term" text={word.term} lang={langs.term} />}
        {graded && item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {graded && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {graded && item.cue?.type === 'audio' && <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio)}><Icon name="volume" /> Listen</TouchButton>}
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
        {!graded && termAudio && <TouchButton variant="secondary" onClick={() => playClip(termAudio)}><Icon name="volume" /> Hear it</TouchButton>}
        {!fieldDisabled && (
          <TouchButton variant="secondary" aria-pressed={keypadOpen} onClick={toggleKeypad}>
            <Icon name="writing" /> Keypad
          </TouchButton>
        )}
        {/* A copy mismatch is a retry, not a terminal result — only a GRADED
            result hides the submit button; copy mode keeps it for the retry. */}
        {(!result || (!graded && result?.correct === false)) && (
          <TouchButton variant="primary" keyHint="Enter" disabled={busy || !value.trim()} onClick={submit}>{busy && graded ? 'Checking…' : 'Enter'}</TouchButton>
        )}
        {!graded && result?.correct === false && <p className="wl-verdict" role="status">Try again — copy it exactly.</p>}
        {graded && result && (
          <p className="wl-verdict" role="status">
            {result.correct && result.score === 10 && 'Right!'}
            {result.correct && result.score < 10 && <>Got it! Here&apos;s the spelling: <span lang={langs.term}>{result.answer}</span></>}
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
