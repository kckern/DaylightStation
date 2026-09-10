import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';
import Icon from '../../../home/icons/Icon.jsx';

/** A control that owns its own keys — a focused button's Enter. The rung's
 *  keys never fire over one of these. */
const ownsKeys = (el) => Boolean(el?.closest?.('button, input, select, textarea, a[href], [contenteditable="true"]'));

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
 * on; the parent holds it on screen until they do, and the sentence they move
 * on to starts playing because they asked for it. The first pass ran the set
 * hands-free instead — one tap, then a sentence every few seconds, no gesture
 * behind any of them — which read as a conveyor belt: the one thing a child
 * could not do was ask for the sentence they had just heard one more time.
 */
export default function RepetitionRung({
  entry, audioUrl, nextEntry, onComplete, saving,
  onHold, onRelease, onAdvance, startOnArrival = false,
}) {
  const [phase, setPhase] = useState('idle'); // idle | playing | done
  const [highlight, setHighlight] = useState(null);
  const rootRef = useRef(null);
  // The key handler reads the phase through a ref so it is bound once per
  // sentence, not once per phase change.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // A replay must not climb the rung twice. `handleEnd` runs at the end of
  // EVERY pass, and the second pass is a listen, not a new attempt: logging it
  // would credit a sentence the learner has already finished. Seeded from the
  // entry, because a held sentence is a FINISHED one and can be mounted afresh
  // — coming back from the Review shelf, say — with its attempt already saved.
  const credited = useRef(Boolean(entry.done));

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
    // The three states this rung gained when it stopped being a conveyor belt —
    // held, replayed, advanced — were invisible from the day they shipped.
    // Without them a session reads as a run of `complete`s and there is no way
    // to tell a child who listened twice from one who was carried along, which
    // is the entire question the change was making answerable.
    languageLog.rung('held', { rung: 'repetition', seq: entry.seq });
    Promise.resolve(onComplete({ seq: entry.seq, rung: 'repetition' })).then((result) => {
      if (result?.ok === false) {
        // Nothing was recorded, so nothing is finished: let the sentence go
        // back to the queue as the attempt it still needs.
        credited.current = false;
        setPhase('idle');
        onRelease?.();
      }
    });
  }, [entry.seq, onComplete, onHold, onRelease]);

  const { playSequence, preload, stop, step, blocked } = useSentenceAudio({ onSequenceEnd: handleEnd });

  useEffect(() => {
    setPhase('idle');
    credited.current = Boolean(entry.done);
    setHighlight(null);
    languageLog.rung('enter', { rung: 'repetition', seq: entry.seq });
    // Take the keyboard on arrival. The tap that brought the child here — a
    // ladder rung, the previous sentence's Next — leaves focus on THAT
    // control, and a Space pressed there would re-press it, not play this.
    rootRef.current?.focus?.({ preventScroll: true });
    // NOT keyed on `entry.done`: the save flips it true while the sentence is
    // still on screen, and re-running this would throw away the very choice the
    // learner just earned. Whether it is already credited is read at mount.
    return () => stop();
  }, [entry.seq, stop]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // A second pass over a sentence already credited is a REPLAY: the child
    // asked to hear it again. It climbs nothing, so it is not a `complete`, and
    // counting the two together would erase the distinction.
    if (phase === 'done') languageLog.rung('replayed', { rung: 'repetition', seq: entry.seq });
    setPhase('playing');
    playSequence(clipsFor(entry, audioUrl));
  }, [entry, audioUrl, playSequence, phase]);

  // The child pressed Next to get HERE, so this sentence plays without a second
  // tap. Once per mount — the component is keyed by sentence, so the ref is per
  // sentence — and never for a sentence merely arrived at: after Stop, or on the
  // first sentence of a rung, the disc waits to be pressed like any other.
  const arrived = useRef(false);
  useEffect(() => {
    if (!startOnArrival || arrived.current) return;
    arrived.current = true;
    start();
  }, [startOnArrival, start]);

  // A rejected play promise ends the sequence without its normal completion
  // callback. Return to a control the learner can actually use instead of
  // leaving the screen saying “tap Play” while offering only Stop.
  useEffect(() => {
    if (!blocked || phase !== 'playing') return;
    stop();
    setPhase('idle');
  }, [blocked, phase, stop]);

  const advance = useCallback(() => {
    languageLog.rung('advanced', { rung: 'repetition', seq: entry.seq });
    onAdvance?.();
  }, [entry.seq, onAdvance]);

  // Hands-free, the whole way through. Space or Enter is "go": play, stop,
  // then Next. Backspace or the left arrow is "again"; the right arrow is
  // Next. The first day on the Portal had none of this — Space did nothing on
  // this rung, and a child with a keyboard in their lap had to reach for the
  // glass at every sentence.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const go = e.key === ' ' || e.key === 'Enter';
      const again = e.key === 'Backspace' || e.key === 'ArrowLeft';
      const next = e.key === 'ArrowRight';
      if (!go && !again && !next) return;
      if (ownsKeys(e.target)) return;
      const current = phaseRef.current;
      if (go) {
        e.preventDefault();
        if (current === 'idle') start();
        else if (current === 'playing') { stop(); setPhase('idle'); }
        else if (current === 'done' && !saving) advance();
        return;
      }
      if (again && (current === 'done' || current === 'idle')) { e.preventDefault(); start(); return; }
      if (next && current === 'done' && !saving) { e.preventDefault(); advance(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, stop, advance, saving]);

  const sourceLang = entry.prompt?.[0]?.language;
  const targetLang = entry.prompt?.find((p) => p.role === 'target')?.language;

  return (
    <div ref={rootRef} tabIndex={-1} className="lang-rung lang-rung--repetition">
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
            <button
              type="button"
              className="lang-btn lang-btn--primary"
              onClick={advance}
            >
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
