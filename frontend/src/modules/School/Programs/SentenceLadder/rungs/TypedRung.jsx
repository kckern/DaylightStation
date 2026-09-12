import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import { useHangulTyping } from '../../../ime/HangulTypingProvider.jsx';
import { columnsFor } from './glyphStrip.js';
import GlyphStrip from './GlyphStrip.jsx';
import Icon from '../../../home/icons/Icon.jsx';

/**
 * The two typing rungs, which are one component (design §5).
 *
 * `dictation` and `interpretation` differ only in which language the learner
 * types and whether the other language is shown as a hint — and BOTH of those
 * come from the server-resolved `entry.response.language`. Splitting them into
 * two components would mean two places to hardcode a language, which is
 * exactly what the role model exists to prevent.
 *
 *   dictation      — hear target, type target. Drawn as TWO COLUMN-ALIGNED
 *                    ROWS (`GlyphStrip`): the model above, the learner's answer
 *                    directly beneath, one grid column per syllable. In
 *                    enrollment-owned `copy` mode the model is shown one glyph
 *                    ahead; in listen mode it is not in the DOM at all.
 *   interpretation — hear target, type source. The target text is shown whole
 *                    and the field stays visible: the task is rendering
 *                    meaning, not tracing a script, so there is nothing to
 *                    align column by column and an English answer aligned
 *                    character by character would just leak its length.
 *
 * WHY THE FIELD IS OFFSCREEN ON THE DICTATION RUNG. The strip's lower row IS
 * the field's rendering — a second, differently-sized copy of the same text
 * directly under it was the old stack's worst moment, because the two type
 * scales had to be kept in sync by hand and never were. The input stays a real,
 * focused, selectable element (see `.is-offscreen`): the in-page IME reads
 * `selectionStart` on every keystroke, so `display:none` / `visibility:hidden`
 * would strand every half-composed syllable.
 *
 * Tab replays the clip. That was the 2016 shortcut and it matters: a learner
 * mid-word should not have to leave the field to hear the sentence again. The
 * shortcut is written ON the play control rather than in a hint line of its
 * own — one line of screen, and it says what the control does.
 *
 * The audio used to LOOP until submit, starting on the first keystroke. A
 * learner typing one Hangul syllable at a time was hammered by the same
 * sentence with nothing on screen that could stop it. The clip now plays once
 * on arrival, a Stop sits beside Play the whole time it sounds, and a silence
 * long enough to mean "stuck" earns exactly one replay.
 */

/**
 * How long the field may sit untouched before the sentence is offered again.
 * A prop with a named default rather than a bare number, because this is the
 * kind of value that ends up differing per learner — a later change threads it
 * from the enrollment YAML through this same seam. Zero disables the replay.
 */
export const DEFAULT_IDLE_REPLAY_MS = 30_000;

export default function TypedRung({
  entry, audioUrl, nextEntry, onComplete, saving, showShortcuts = false,
  idleReplayMs = DEFAULT_IDLE_REPLAY_MS,
}) {
  const [value, setValue] = useState('');
  /**
   * What the IME says is SETTLED and what is still in flight.
   *
   * Never `value`. In 두벌식 a consonant is genuinely ambiguous until the next
   * vowel lands: typing 오늘 leaves the field reading 온 after ㄴ, and only the
   * next vowel decides whether that ㄴ closed 오 or opened 늘. A strip fed the
   * field value calls column 0 settled-and-WRONG at that moment, reddens it and
   * jumps the caret on — then undoes itself a keystroke later. The glyph the
   * child is in the middle of typing disappears out from under them.
   * `compositionState` is the seam that makes that impossible.
   */
  const [typed, setTyped] = useState({ committed: '', pending: '' });
  const [played, setPlayed] = useState(false);
  // Sticky, unlike `saving`: the answer is in, so nothing may start sounding
  // while the program works out which rung comes next.
  const [submitted, setSubmitted] = useState(false);
  // Stop means QUIET, not "quiet for thirty seconds". A learner who silences
  // the sentence has told us the audio is in their way; bringing it back on a
  // timer would re-impose exactly the thing they just refused, which is the
  // loop again in slower clothes. Cleared by any explicit ask — Tab, or the
  // Play button — so resuming costs one key and never needs explaining.
  const [hushed, setHushed] = useState(false);
  const inputRef = useRef(null);

  const { compositionState } = useHangulTyping();
  const { playSequence, preload, stop, playing, blocked } = useSentenceAudio();

  const responseLang = entry.response?.language;
  const promptLang = entry.prompt?.[0]?.language;
  const isDictation = entry.rung === 'dictation';
  const isCopying = isDictation && entry.copyPrompt === true;
  const targetText = entry.text?.[promptLang] ?? '';

  /**
   * How much of the model the strip is allowed to draw. Copy mode traces a
   * visible sentence; listen mode must not have it in the DOM at all, or the
   * drill is a reading exercise for anyone who can reach devtools. Threaded as
   * a value rather than inlined so the peek control that flips it to 'all' is
   * one line here and nothing at all in `glyphStrip.js`.
   */
  const reveal = isCopying ? 'model' : 'none';
  const columns = useMemo(
    () => columnsFor({
      target: targetText, committed: typed.committed, pending: typed.pending, reveal,
    }),
    [targetText, typed.committed, typed.pending, reveal],
  );

  // NOTE: do NOT reset `value`/`played` here. This component is remounted per
  // entry via `key={rung-seq}` (in SentenceLadderProgram), so each entry already
  // starts with fresh state. A `setValue('')` in this effect is not only
  // redundant — it RACES: the parent's caps/day load cascade can defer this
  // passive effect until after the learner has begun typing, and it then wipes
  // their input. Keep only the per-entry enter log and the audio-stop cleanup.
  useEffect(() => {
    languageLog.rung('enter', { rung: entry.rung, seq: entry.seq });
    // Hands on the keys from the first frame: the tap that brought the child
    // here left focus on a ladder rung or a Next button, and typing there
    // goes nowhere. Focus the field so the first keystroke is the first letter.
    inputRef.current?.focus?.({ preventScroll: true });
    return () => stop();
  }, [entry.seq, entry.rung, stop]);

  useEffect(() => {
    if (!nextEntry) return;
    preload((nextEntry.prompt || []).map((p) => audioUrl(nextEntry.seq, p.language)));
  }, [nextEntry, audioUrl, preload]);

  const play = useCallback(() => {
    setPlayed(true);
    // Asking for the sentence is what un-hushes it.
    setHushed(false);
    // Emphatically NOT `{ loop: true }`. Repeating until submit turned support
    // into a siren for anyone typing slowly, and there was no control on the
    // rung that could stop it. One pass; Play again, Tab, or the idle replay
    // brings it back when the learner wants it.
    playSequence(clipsFor(entry, audioUrl), { loop: false });
    // Return focus so the learner can keep typing without a second tap.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [entry, audioUrl, playSequence]);

  // The sentence plays because the learner ARRIVED, not because they started
  // typing. Starting it from the first keystroke meant the audio began at the
  // moment their attention was already on the keys — and then never stopped.
  // Once per mount, and the component is keyed per entry, so the ref is per
  // sentence. Deliberately a separate effect from the enter/cleanup one above,
  // whose warning about resetting state still stands.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    play();
  }, [play]);

  const stopPlayback = useCallback(() => {
    languageLog.rung('stopped', { rung: entry.rung, seq: entry.seq });
    setHushed(true);
    stop();
    inputRef.current?.focus();
  }, [stop, entry.rung, entry.seq]);

  // Going quiet is what a stuck learner looks like, and hearing the sentence
  // again is what the loop was reaching for before it became a siren. So:
  // exactly one replay after a silence. Keyed on `value`, so every keystroke
  // restarts the wait; on `playing`, so it never talks over itself; dead once
  // the attempt is in. A non-finite or non-positive interval turns it off.
  useEffect(() => {
    if (!Number.isFinite(idleReplayMs) || idleReplayMs <= 0) return undefined;
    if (playing || submitted || saving) return undefined;
    // Silenced on purpose. See `hushed`.
    if (hushed) return undefined;
    // A kiosk that has not been touched yet fails the autoplay gate, and a
    // rejected play cannot un-reject itself. Retrying on a timer would be
    // inaudible and would beat a `play-blocked` warn into the log store every
    // interval, forever. The notice on screen asks for the tap instead.
    if (blocked) return undefined;

    const timer = window.setTimeout(() => {
      languageLog.rung('idle-replay', { rung: entry.rung, seq: entry.seq, afterMs: idleReplayMs });
      play();
    }, idleReplayMs);
    return () => window.clearTimeout(timer);
  }, [idleReplayMs, playing, submitted, saving, blocked, hushed, value, play, entry.rung, entry.seq]);

  const submit = useCallback(() => {
    if (!value.trim() || saving) return;
    setSubmitted(true);
    stop();
    languageLog.rung('complete', { rung: entry.rung, seq: entry.seq });
    onComplete({ seq: entry.seq, rung: entry.rung, given: value });
  }, [value, saving, stop, entry, onComplete]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      play();
      return;
    }
    // No Space branch. Space used to mean "play" while the field was empty,
    // which reads fine in English and is a trap in Korean: 오늘 온 사람 begins
    // with a word, then a space the learner cannot type. The key is a space.
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }, [play, submit]);

  const label = isCopying ? 'Copy the sentence' : isDictation ? 'Type what you hear' : 'Type what it means';

  return (
    <div className={`lang-rung lang-rung--${entry.rung}`}>
      {blocked && (
        <p className="lang-rung__notice" role="alert">Audio was blocked — tap Play again.</p>
      )}

      {/* The drill, taking the height the baseline leaves it. */}
      <div className="lang-rung__stage">
        {/* Dictation gets the two column-aligned rows; interpretation gets the
            whole target sentence and a visible field, because there is no
            per-syllable correspondence to draw and an English answer aligned
            character by character would only leak its length. */}
        {isDictation
          ? <GlyphStrip columns={columns} caret={!saving && !submitted} />
          : <p className="lang-rung__target">{targetText}</p>}

        {/* Kept on the dictation rung for the accessible name only: the strip is
            `role="presentation"` duplication of this field, so the field is still
            the labelled control, but a visible caption above two rows that already
            say "model here, your answer here" is the stack this screen shed. */}
        <label
          className={`lang-rung__label${isDictation ? ' is-offscreen' : ''}`}
          htmlFor={`lang-input-${entry.seq}`}
        >
          {label}
        </label>
        <input
          id={`lang-input-${entry.seq}`}
          ref={inputRef}
          className={`lang-rung__input${isDictation ? ' is-offscreen' : ''}`}
          type="text"
          lang={responseLang}
          /* Drives the School-wide in-page IME: dictation asks for the target
             script, interpretation for the source, and the mode follows focus
             with no keypress. F6 still overrides. */
          data-ime-lang={responseLang}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            // Nothing starts playing here any more. This line is where the loop
            // was armed — the first keystroke began audio that then ran until
            // submit — so the one job a keystroke has now is to be a keystroke.
            // (It also restarts the idle wait, via the effect's `value` dep.)
            setValue(e.target.value);
            // Read from the composer DURING its own change event, which is the
            // only moment its answer is guaranteed current — see the note on
            // `typed` above for why the field's value will not do.
            setTyped(compositionState(e.target));
          }}
          onKeyDown={onKeyDown}
          disabled={saving}
        />
      </div>

      {/* The baseline: what sounds, on the left with its shortcut written on
          it, and the way forward on the right. Audio is NOT a column — a 90px
          disc owning the vertical centre of the screen made the loudest thing
          on a typing rung the thing the learner needs least often. */}
      <div className="lang-rung__baseline">
        <div className="lang-rung__cues">
          <button
            type="button"
            className="lang-btn lang-btn--quiet"
            onClick={play}
          >
            <Icon name="play" className="lang-btn__glyph" />
            <span className="lang-btn__word">{played ? 'Play again' : 'Play'}</span>
            {/* The visible caption, and the shortcut ONLY where those keys
                exist: a touch panel may have a Hangul IME on its on-screen
                keyboard and no Tab key at all, and instructions for absent
                hardware are worse than no instructions. Held out of the
                accessible name so the control is still just "Play again". */}
            <span className="lang-btn__key" aria-hidden="true">
              {showShortcuts ? 'Tab plays' : (played ? 'Play again' : 'Play')}
            </span>
          </button>
          {/* The way out of the sound. While the clip looped there was no such
              control anywhere on this rung: the only escape was to finish
              typing. It appears only while something is actually sounding, so
              the row never offers a Stop with nothing to stop. */}
          {playing && (
            <button
              type="button"
              className="lang-btn lang-btn--quiet"
              onClick={stopPlayback}
            >
              <Icon name="pause" className="lang-btn__glyph" />
              <span className="lang-btn__word">Stop</span>
              <span className="lang-btn__key" aria-hidden="true">Stop</span>
            </button>
          )}
        </div>
        <button
          type="button"
          className="lang-btn lang-btn--primary"
          onClick={submit}
          disabled={!value.trim() || saving}
        >
          {saving ? 'Saving…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
