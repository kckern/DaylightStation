import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';

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
 */
export default function TypedRung({ entry, audioUrl, nextEntry, onComplete, saving, showShortcuts = false }) {
  const [value, setValue] = useState('');
  const [played, setPlayed] = useState(false);
  const inputRef = useRef(null);

  const { playSequence, preload, stop, blocked } = useSentenceAudio();

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
    return () => stop();
  }, [entry.seq, entry.rung, stop]);

  useEffect(() => {
    if (!nextEntry) return;
    preload((nextEntry.prompt || []).map((p) => audioUrl(nextEntry.seq, p.language)));
  }, [nextEntry, audioUrl, preload]);

  const play = useCallback(() => {
    setPlayed(true);
    playSequence(clipsFor(entry, audioUrl), { loop: true });
    // Return focus so the learner can keep typing without a second tap.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [entry, audioUrl, playSequence]);

  const submit = useCallback(() => {
    if (!value.trim() || saving) return;
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
          className={`lang-btn${played ? '' : ' lang-btn--primary'}`}
          onClick={play}
        >
          {played ? 'Play again' : 'Play'}
        </button>
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
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          // Typing is a trusted browser gesture. Starting the loop here means
          // a learner who begins from the copy prompt gets the same repeating
          // audio support as someone who pressed Play first.
          if (!played) play();
          setValue(e.target.value);
        }}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
      {/* Only where those keys exist. A touch panel may have a Hangul IME on
          its on-screen keyboard and no Tab key at all, and instructions for
          absent hardware are worse than no instructions. */}
      {showShortcuts && <p className="lang-rung__hint">Tab replays · Enter submits</p>}

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
