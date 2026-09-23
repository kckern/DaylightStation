import { useEffect, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { playClip } from '../cardLadderAudio.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import AnchorCue, { anchorCueAudio } from './AnchorCue.jsx';

/**
 * Drill step "tiles" (pick-spelling): the cue, and the term's syllables plus
 * two decoys as tiles. Tap a tile to append it to the answer row; tap an
 * answer tile to take it back. Check sends `{tiles}` in the tapped order.
 *
 * The item never carries the term. A miss comes back as a retry
 * (`result.correct === false`, same item): "Not quite", and after the second
 * miss the server's `result.answer` shows the spelling. `pending` = the
 * server has moved on (a match, or the third try), so the verdict waits for Next.
 */
export default function TilesItem({ item, langs, resolveAssetUrl, onRespond, result = null, pending = false, onContinue, busy = false }) {
  const tiles = item.tiles ?? [];
  const [answer, setAnswer] = useState([]); // indexes into `tiles` (syllables can repeat)
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  useEffect(() => {
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio, 'gloss', { trigger: 'auto' });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A retry starts from an empty row.
  useEffect(() => { if (result && result.correct === false && !pending) setAnswer([]); }, [result, pending]);

  const locked = busy || pending;
  const add = (index) => { if (!locked && !answer.includes(index)) setAnswer((a) => [...a, index]); };
  const remove = (at) => { if (!locked) setAnswer((a) => a.filter((_, i) => i !== at)); };
  const check = () => { if (!locked && answer.length) onRespond({ tiles: answer.map((i) => tiles[i]) }); };

  // Tab = hear the audio cue again (only when there is one).
  const cueClip = anchorCueAudio(item, resolveAssetUrl);
  const hearKeys = cueClip ? { tab: () => playClip(cueClip, 'gloss') } : {};
  useCardLadderKeys(pending
    ? { ' ': onContinue, enter: onContinue, ...hearKeys }
    : {
      enter: check,
      ...hearKeys,
      backspace: () => remove(answer.length - 1),
      ...Object.fromEntries(tiles.map((_, i) => [String(i + 1), () => add(i)])),
    });

  return (
    <section className="wl-item wl-tiles" aria-label="Spell it">
      <div className="wl-prompt">
        <AnchorCue item={item} resolveAssetUrl={resolveAssetUrl} lang={langs.anchor} />
      </div>
      <div className="wl-tiles__answer" role="group" aria-label="Your answer" lang={langs.target}>
        {answer.map((index, at) => (
          <TouchButton key={`${index}`} variant="choice" lang={langs.target} disabled={locked} onClick={() => remove(at)}>{tiles[index]}</TouchButton>
        ))}
      </div>
      <div className="wl-tiles__pool" role="group" aria-label="Tiles">
        {tiles.map((tile, i) => (
          <TouchButton
            key={`${tile}-${i}`}
            variant="choice"
            keyHint={String(i + 1)}
            lang={langs.target}
            className={answer.includes(i) ? 'is-used' : ''}
            disabled={locked || answer.includes(i)}
            onClick={() => add(i)}
          >
            {tile}
          </TouchButton>
        ))}
      </div>
      <div className="wl-controls">
        {result && (
          <p className="wl-verdict" role="status">
            {result.correct ? 'Right!' : 'Not quite.'}
            {!result.correct && result.answer && <> It&apos;s <span lang={langs.target}>{result.answer}</span></>}
          </p>
        )}
        {!pending && <TouchButton variant="primary" keyHint="Enter" disabled={busy || !answer.length} onClick={check}>Check</TouchButton>}
        {pending && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
    </section>
  );
}
