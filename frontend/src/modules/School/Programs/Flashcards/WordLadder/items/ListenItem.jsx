import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

const GAP_MS = 1500;

/**
 * Practice Listen: every word's native audio in turn, its term on screen while
 * it plays, 1.5 s apart. Starts by itself; Again replays the run from the top.
 * Nothing is asked — Next sends `{done:true}`.
 */
export default function ListenItem({ item, langs, resolveAssetUrl, onRespond, busy = false }) {
  const words = item.words ?? [];
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const run = useRef(0);

  const play = useCallback(async () => {
    const mine = ++run.current;
    setPlaying(true);
    for (let i = 0; i < words.length; i += 1) {
      if (mine !== run.current) return;
      setCurrent(i);
      await playClip(resolveAssetUrl(words[i].audio));
      if (mine !== run.current) return;
      if (i < words.length - 1) await new Promise((resolve) => { setTimeout(resolve, GAP_MS); });
    }
    if (mine === run.current) { setPlaying(false); setCurrent(null); }
  }, [words, resolveAssetUrl]);

  useEffect(() => {
    play();
    return () => { run.current += 1; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => { if (!busy) { run.current += 1; onRespond({ done: true }); } };
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
