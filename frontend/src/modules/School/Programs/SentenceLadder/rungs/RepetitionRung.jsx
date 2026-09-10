import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import Icon from '../../../home/icons/Icon.jsx';

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
 *
 * A finished sentence STAYS. The learner chooses to hear it again or to move
 * on; the parent holds it on screen until they do. The first pass ran the set
 * hands-free instead — one tap, then a sentence every few seconds — which read
 * as a conveyor belt: the one thing a child could not do was ask for the
 * sentence they had just heard one more time.
 */
export default function RepetitionRung({
  entry, audioUrl, nextEntry, onComplete, saving, onHold, onAdvance,
}) {
  const [phase, setPhase] = useState('idle'); // idle | playing | done
  const [highlight, setHighlight] = useState(null);
  // A replay must not climb the rung twice. `handleEnd` runs at the end of
  // EVERY pass, and the second pass is a listen, not a new attempt: logging it
  // would credit a sentence the learner has already finished.
  const credited = useRef(false);

  const handleEnd = useCallback(() => {
    setPhase('done');
    setHighlight(null);
    if (credited.current) return;
    credited.current = true;
    languageLog.rung('complete', { rung: 'repetition', seq: entry.seq });
    // Held BEFORE the save resolves, not after: the save re-derives the day,
    // and the parent's ladder would otherwise step to the next rung in the
    // render between the two.
    onHold?.();
    Promise.resolve(onComplete({ seq: entry.seq, rung: 'repetition' })).then((result) => {
      if (result?.ok === false) {
        // Nothing was recorded, so nothing is finished: let the sentence go
        // back to the queue as the attempt it still needs.
        credited.current = false;
        setPhase('idle');
        onAdvance?.();
      }
    });
  }, [entry.seq, onComplete, onHold, onAdvance]);

  const { playSequence, preload, stop, step, blocked } = useSentenceAudio({ onSequenceEnd: handleEnd });

  useEffect(() => {
    setPhase('idle');
    credited.current = false;
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

  // Every pass starts from a tap — the first one is what grants the browser the
  // audio activation that makes any of this audible, and nothing here plays
  // without one.
  const start = useCallback(() => {
    setPhase('playing');
    playSequence(clipsFor(entry, audioUrl));
  }, [entry, audioUrl, playSequence]);

  // A rejected play promise ends the sequence without its normal completion
  // callback. Return to a control the learner can actually use instead of
  // leaving the screen saying “tap Play” while offering only Stop.
  useEffect(() => {
    if (!blocked || phase !== 'playing') return;
    stop();
    setPhase('idle');
  }, [blocked, phase, stop]);

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
          <button type="button" className="lang-btn lang-btn--disc" onClick={start}>
            <Icon name="play" className="lang-btn__glyph" />
            <span className="lang-btn__word">Play</span>
          </button>
        )}
        {phase === 'playing' && (
          <button
            type="button"
            className="lang-btn lang-btn--disc lang-btn--disc-quiet"
            onClick={() => { stop(); setPhase('idle'); }}
          >
            <Icon name="pause" className="lang-btn__glyph" />
            <span className="lang-btn__word">Stop</span>
          </button>
        )}
        {/* The choice. Repeating is the quiet disc beside Play's, because it is
            the same act; moving on is the deliberate one, so it carries the
            weight. Both wait for the save — an attempt still in flight has
            nothing to offer yet. */}
        {phase === 'done' && saving && <span className="lang-rung__saved">Saving…</span>}
        {phase === 'done' && !saving && (
          <>
            <button type="button" className="lang-btn lang-btn--disc lang-btn--disc-quiet" onClick={start}>
              <Icon name="restart" className="lang-btn__glyph" />
              <span className="lang-btn__word">Play again</span>
            </button>
            <button type="button" className="lang-btn lang-btn--primary" onClick={() => onAdvance?.()}>
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
