import { useEffect, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import CuePicture from './CuePicture.jsx';

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
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  useEffect(() => {
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A retry starts from an empty row.
  useEffect(() => { if (result && result.correct === false && !pending) setAnswer([]); }, [result, pending]);

  const locked = busy || pending;
  const add = (index) => { if (!locked && !answer.includes(index)) setAnswer((a) => [...a, index]); };
  const remove = (at) => { if (!locked) setAnswer((a) => a.filter((_, i) => i !== at)); };
  const check = () => { if (!locked && answer.length) onRespond({ tiles: answer.map((i) => tiles[i]) }); };

  useWordLadderKeys(pending
    ? { ' ': onContinue, enter: onContinue }
    : {
      enter: check,
      backspace: () => remove(answer.length - 1),
      ...Object.fromEntries(tiles.map((_, i) => [String(i + 1), () => add(i)])),
    });

  return (
    <section className="wl-item wl-tiles" aria-label="Spell it">
      <div className="wl-prompt">
        {item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {item.cue?.type === 'audio' && <TouchButton variant="secondary" onClick={() => glossAudio && playClip(glossAudio)}><Icon name="volume" /> Listen</TouchButton>}
      </div>
      <div className="wl-tiles__answer" role="group" aria-label="Your answer" lang={langs.term}>
        {answer.map((index, at) => (
          <TouchButton key={`${index}`} variant="choice" lang={langs.term} disabled={locked} onClick={() => remove(at)}>{tiles[index]}</TouchButton>
        ))}
      </div>
      <div className="wl-tiles__pool" role="group" aria-label="Tiles">
        {tiles.map((tile, i) => (
          <TouchButton
            key={`${tile}-${i}`}
            variant="choice"
            keyHint={String(i + 1)}
            lang={langs.term}
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
            {!result.correct && result.answer && <> It&apos;s <span lang={langs.term}>{result.answer}</span></>}
          </p>
        )}
        {!pending && <TouchButton variant="primary" keyHint="Enter" disabled={busy || !answer.length} onClick={check}>Check</TouchButton>}
        {pending && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
    </section>
  );
}
