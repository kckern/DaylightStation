import { useCallback, useEffect, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';

/**
 * Repetition — the shadowing rung (design §1).
 *
 * Plays source, then target, then target again. There is nothing to submit:
 * the learner says the sentence aloud in the gap before the repeat, and
 * clearing the rung means having sat through it. That is deliberate — the 2016
 * app never scored this either, and a self-report button would only add a lie
 * the learner can tell.
 *
 * This is the only rung with no input requirement, which is why new sentences
 * enter here and why it is the one rung a bare touch panel can always run.
 */
export default function RepetitionRung({ entry, audioUrl, nextEntry, onComplete, saving }) {
  const [phase, setPhase] = useState('idle'); // idle | playing | done
  const [highlight, setHighlight] = useState(null);

  const handleEnd = useCallback(() => {
    setPhase('done');
    setHighlight(null);
    languageLog.rung('complete', { rung: 'repetition', seq: entry.seq });
    onComplete({ seq: entry.seq, rung: 'repetition' });
  }, [entry.seq, onComplete]);

  const { playSequence, preload, stop, step, blocked } = useSentenceAudio({ onSequenceEnd: handleEnd });

  useEffect(() => {
    setPhase('idle');
    setHighlight(null);
    languageLog.rung('enter', { rung: 'repetition', seq: entry.seq });
    return () => stop();
  }, [entry.seq, stop]);

  // Warm the next sentence while this one is on screen. Without this the gap
  // between sentences reads as the app hanging.
  useEffect(() => {
    if (!nextEntry) return;
    preload((nextEntry.prompt || []).map((p) => audioUrl(nextEntry.seq, p.language)));
  }, [nextEntry, audioUrl, preload]);

  // Follow along: highlight whichever line is currently sounding.
  useEffect(() => {
    const clips = clipsFor(entry, audioUrl);
    setHighlight(step >= 0 && clips[step] ? clips[step].language : null);
  }, [step, entry, audioUrl]);

  const start = useCallback(() => {
    setPhase('playing');
    playSequence(clipsFor(entry, audioUrl));
  }, [entry, audioUrl, playSequence]);

  const sourceLang = entry.prompt?.[0]?.language;
  const targetLang = entry.prompt?.find((p) => p.role === 'target')?.language;

  return (
    <div className="lang-rung lang-rung--repetition">
      <p className={`lang-rung__source${highlight === sourceLang ? ' is-sounding' : ''}`}>
        {entry.text?.[sourceLang]}
      </p>
      <p className={`lang-rung__target${highlight === targetLang ? ' is-sounding' : ''}`}>
        {entry.text?.[targetLang]}
      </p>

      {blocked && (
        <p className="lang-rung__notice" role="alert">
          Audio was blocked — tap Play again.
        </p>
      )}

      <div className="lang-rung__controls">
        {phase === 'idle' && (
          <button type="button" className="lang-btn lang-btn--primary" onClick={start}>
            Play
          </button>
        )}
        {phase === 'playing' && (
          <button type="button" className="lang-btn" onClick={() => { stop(); setPhase('idle'); }}>
            Stop
          </button>
        )}
        {phase === 'done' && (
          <span className="lang-rung__saved">{saving ? 'Saving…' : 'Done'}</span>
        )}
      </div>
    </div>
  );
}
