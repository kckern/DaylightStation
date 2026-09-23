import { useEffect, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

/**
 * 2.1 flashcard. Front: the Korean only (text + sound) — never the picture or
 * the English, which ARE the answer. Back: picture and/or English (0.2 reveal).
 * `mode: 'intro'` (0.1, one Next) or `'stream'` (2.1, three sort tones).
 */
export default function FlashcardItem({ item, langs, resolveAssetUrl, onRespond, busy = false }) {
  const { word } = item;
  const [flipped, setFlipped] = useState(false);
  const audio = word.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  const image = word.media?.image ? resolveAssetUrl(word.media.image) : null;
  const [imageOk, setImageOk] = useState(true);
  useEffect(() => { setFlipped(false); setImageOk(true); if (audio) playClip(audio); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = () => setFlipped((f) => !f);
  const act = (response) => { if (!busy) onRespond(response); };
  const stream = item.mode === 'stream';
  useWordLadderKeys({
    ' ': flipped && !stream ? () => act({ seen: true }) : flip,
    enter: flipped && !stream ? () => act({ seen: true }) : flip,
    h: () => audio && playClip(audio),
    ...(stream ? { u: () => act({ undo: true }), q: () => act({ quizNow: true }) } : {}),
    ...(stream && flipped ? { 1: () => act({ sort: 'notYet' }), 2: () => act({ sort: 'familiar' }), 3: () => act({ sort: 'claimed' }) } : {}),
  });
  return (
    <section className="wl-item wl-flashcard" aria-label={stream ? 'Flashcard' : 'New word'}>
      <button type="button" className={`wl-card${flipped ? ' is-flipped' : ''}`} onClick={flip} aria-label={flipped ? 'Show the Korean' : 'Flip the card'}>
        {!flipped ? (
          <div className="wl-card__face wl-card__face--front"><FitText role="term" text={word.term} lang={langs.term} /></div>
        ) : (
          <div className={`wl-card__face wl-card__face--back${image && imageOk ? ' has-picture' : ''}`}>
            {image && imageOk && <img className="wl-card__picture" src={image} alt={word.gloss} onError={() => setImageOk(false)} />}
            <div className="wl-card__gloss"><FitText role="gloss" text={word.gloss} lang={langs.gloss} /></div>
            {word.pronunciation && <p className="wl-card__pron">{word.pronunciation}</p>}
          </div>
        )}
      </button>
      <div className="wl-controls">
        {audio && <TouchButton variant="secondary" keyHint="H" onClick={() => playClip(audio)}><Icon name="volume" /> Hear it</TouchButton>}
        {!flipped && <TouchButton variant="primary" keyHint="Space" onClick={flip}>Flip</TouchButton>}
        {flipped && !stream && <TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={() => act({ seen: true })}>Next</TouchButton>}
        {flipped && stream && (
          <>
            <TouchButton variant="sort-notyet" keyHint="1" disabled={busy} onClick={() => act({ sort: 'notYet' })}>Not yet</TouchButton>
            <TouchButton variant="sort-familiar" keyHint="2" disabled={busy} onClick={() => act({ sort: 'familiar' })}>Familiar</TouchButton>
            <TouchButton variant="sort-gotit" keyHint="3" disabled={busy} onClick={() => act({ sort: 'claimed' })}>Got it</TouchButton>
          </>
        )}
      </div>
      {stream && (
        <div className="wl-controls wl-controls--minor">
          <TouchButton variant="secondary" keyHint="U" disabled={busy} onClick={() => act({ undo: true })}>Undo</TouchButton>
          <TouchButton variant="secondary" keyHint="Q" disabled={busy} onClick={() => act({ quizNow: true })}>Quiz me</TouchButton>
        </div>
      )}
    </section>
  );
}
