import { useCallback, useEffect, useRef, useState } from 'react';
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
 *   dictation      — hear target, type target. Nothing is shown; that is the test.
 *   interpretation — hear target, type source. The target text is shown, since
 *                    the task is rendering meaning, not recalling the audio.
 *
 * Tab replays the clip. That was the 2016 shortcut and it matters: a learner
 * mid-word should not have to leave the field to hear the sentence again.
 */
export default function TypedRung({ entry, audioUrl, nextEntry, onComplete, saving }) {
  const [value, setValue] = useState('');
  const [played, setPlayed] = useState(false);
  const inputRef = useRef(null);

  const { playSequence, preload, stop, blocked } = useSentenceAudio();

  const responseLang = entry.response?.language;
  const promptLang = entry.prompt?.[0]?.language;
  const isDictation = entry.rung === 'dictation';

  useEffect(() => {
    setValue('');
    setPlayed(false);
    languageLog.rung('enter', { rung: entry.rung, seq: entry.seq });
    return () => stop();
  }, [entry.seq, entry.rung, stop]);

  useEffect(() => {
    if (!nextEntry) return;
    preload((nextEntry.prompt || []).map((p) => audioUrl(nextEntry.seq, p.language)));
  }, [nextEntry, audioUrl, preload]);

  const play = useCallback(() => {
    setPlayed(true);
    playSequence(clipsFor(entry, audioUrl));
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
        <button type="button" className="lang-btn lang-btn--primary" onClick={play}>
          {played ? 'Play again' : 'Play'}
        </button>
      </div>

      {blocked && (
        <p className="lang-rung__notice" role="alert">Audio was blocked — tap Play again.</p>
      )}

      {/* Dictation shows nothing: recalling the sentence IS the task.
          Interpretation shows the target, because rendering meaning is. */}
      {!isDictation && (
        <p className="lang-rung__target">{entry.text?.[promptLang]}</p>
      )}

      <label className="lang-rung__label" htmlFor={`lang-input-${entry.seq}`}>
        {isDictation ? 'Type what you hear' : 'Type what it means'}
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
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
      <p className="lang-rung__hint">Tab replays · Enter submits</p>

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
