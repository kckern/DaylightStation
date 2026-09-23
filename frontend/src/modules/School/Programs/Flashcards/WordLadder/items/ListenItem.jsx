import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { startClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

const GAP_MS = 1500;

/**
 * Practice Listen: every word's native audio in turn, its term on screen while
 * it plays, 1.5 s apart. Starts by itself; Again replays the run from the top
 * (only once a run has finished — never over one still playing). Next or
 * leaving stops the clip that is playing. Nothing is asked — Next sends
 * `{done:true}`.
 */
export default function ListenItem({ item, langs, resolveAssetUrl, onRespond, busy = false }) {
  const words = item.words ?? [];
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const run = useRef(0);
  const clip = useRef(null);
  const gap = useRef(null);

  const halt = useCallback(() => {
    run.current += 1;
    clip.current?.stop();
    clip.current = null;
    clearTimeout(gap.current);
    playingRef.current = false;
  }, []);

  const play = useCallback(async () => {
    if (playingRef.current) return;
    const mine = ++run.current;
    playingRef.current = true;
    setPlaying(true);
    for (let i = 0; i < words.length; i += 1) {
      if (mine !== run.current) return;
      setCurrent(i);
      clip.current = startClip(resolveAssetUrl(words[i].audio));
      await clip.current.done;
      if (mine !== run.current) return;
      if (i < words.length - 1) await new Promise((resolve) => { gap.current = setTimeout(resolve, GAP_MS); });
    }
    if (mine === run.current) { clip.current = null; playingRef.current = false; setPlaying(false); setCurrent(null); }
  }, [words, resolveAssetUrl]);

  useEffect(() => {
    play();
    return halt;
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => { if (!busy) { halt(); onRespond({ done: true }); } };
  useWordLadderKeys({ ' ': next, enter: next, a: play });
  const shown = current ?? 0;
  return (
    <section className="wl-item wl-listen" aria-label="Listen">
      <div className="wl-prompt">
        {words.length
          ? <FitText key={words[shown].wordId} role="term" text={words[shown].term} lang={langs.term} />
          : <p className="wl-verdict">No sounds for these words yet.</p>}
      </div>
      {words.length > 0 && <p className="wl-listen__count" aria-live="polite">{shown + 1} of {words.length}</p>}
      <div className="wl-controls">
        {words.length > 0 && (
          <TouchButton variant="secondary" keyHint="A" disabled={playing} onClick={play}><Icon name="restart" /> Again</TouchButton>
        )}
        <TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={next}>Next</TouchButton>
      </div>
    </section>
  );
}
