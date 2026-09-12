import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
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
 *   dictation      — hear target, type target. In enrollment-owned `copy`
 *                    mode, one target glyph is revealed ahead of the matching
 *                    typed prefix, so early learners can practise entering
 *                    the script without being handed the whole sentence.
 *   interpretation — hear target, type source. The target text is shown, since
 *                    the task is rendering meaning, not recalling the audio.
 *
 * Tab replays the clip. That was the 2016 shortcut and it matters: a learner
 * mid-word should not have to leave the field to hear the sentence again.
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

  const { playSequence, preload, stop, playing, blocked } = useSentenceAudio();

  const responseLang = entry.response?.language;
  const promptLang = entry.prompt?.[0]?.language;
  const isDictation = entry.rung === 'dictation';
  const isCopying = isDictation && entry.copyPrompt === true;
  const showPromptText = !isDictation || isCopying;
  const targetText = entry.text?.[promptLang] ?? '';
  const visibleTargetText = useMemo(() => {
    if (!isCopying) return targetText;
    const targetGlyphs = Array.from(targetText);
    const typedGlyphs = Array.from(value);
    let matched = 0;
    while (matched < typedGlyphs.length && typedGlyphs[matched] === targetGlyphs[matched]) matched += 1;
    // Keep exactly one upcoming glyph in view. Precomposed Hangul syllables
    // are one code point, which is the step the learner sees on the keyboard.
    return targetGlyphs.slice(0, Math.min(matched + 1, targetGlyphs.length)).join('');
  }, [isCopying, targetText, value]);

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

  return (
    <div className={`lang-rung lang-rung--${entry.rung}`}>
      <div className="lang-rung__controls">
        {/* Play leads until it has been used; after that Submit is the only
            primary, so the screen always answers "what do I do next" once. */}
        <button
          type="button"
          className={`lang-btn lang-btn--disc${played ? ' lang-btn--disc-quiet' : ''}`}
          onClick={play}
        >
          <Icon name="play" className="lang-btn__glyph" />
          <span className="lang-btn__word">{played ? 'Play again' : 'Play'}</span>
        </button>
        {/* The way out of the sound, in the same row and the same disc the
            repetition rung uses. While the clip looped there was no such
            control anywhere on this rung: the only escape was to finish
            typing. It appears only while something is actually sounding, so
            the row never offers a Stop with nothing to stop. */}
        {playing && (
          <button
            type="button"
            className="lang-btn lang-btn--disc lang-btn--disc-quiet"
            onClick={stopPlayback}
          >
            <Icon name="pause" className="lang-btn__glyph" />
            <span className="lang-btn__word">Stop</span>
          </button>
        )}
      </div>

      {blocked && (
        <p className="lang-rung__notice" role="alert">Audio was blocked — tap Play again.</p>
      )}

      {/* Ordinary dictation shows nothing: recalling the sentence is the task.
          Copy mode intentionally reveals it for script-entry practice. */}
      {showPromptText && (
        <p className="lang-rung__target" aria-live={isCopying ? 'polite' : undefined}>{visibleTargetText}</p>
      )}

      <label className="lang-rung__label" htmlFor={`lang-input-${entry.seq}`}>
        {isCopying ? 'Copy the sentence' : isDictation ? 'Type what you hear' : 'Type what it means'}
      </label>
      <input
        id={`lang-input-${entry.seq}`}
        ref={inputRef}
        className="lang-rung__input"
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
        }}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
      {/* Only where those keys exist. A touch panel may have a Hangul IME on
          its on-screen keyboard and no Tab key at all, and instructions for
          absent hardware are worse than no instructions. */}
      {showShortcuts && <p className="lang-rung__hint">Tab plays the sentence · Enter submits</p>}

      <div className="lang-rung__controls">
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
