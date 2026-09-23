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
 * `mode: 'practice'` (practice menu): `item.front` picks the side facing up —
 * `'gloss'` swaps the faces, so the Korean (and its sound) is the answer and
 * waits for the flip. Flipped: sort 1/2/3 as in the stream, or Next `{next:true}`.
 */
export default function FlashcardItem({ item, langs, resolveAssetUrl, onRespond, busy = false }) {
  const { word } = item;
  const [flipped, setFlipped] = useState(false);
  const audio = word.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  const image = word.media?.image ? resolveAssetUrl(word.media.image) : null;
  const [imageOk, setImageOk] = useState(true);
  const stream = item.mode === 'stream';
  const practice = item.mode === 'practice';
  const sorts = stream || practice;
  const glossFront = practice && item.front === 'gloss';
  // The term's sound is on the term's side: never before the flip on a meaning-first card.
  const termShowing = glossFront ? flipped : !flipped;
  const soundOk = audio && (!glossFront || flipped);
  useEffect(() => { setFlipped(false); setImageOk(true); if (audio && !glossFront) playClip(audio); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = () => {
    // Turning a meaning-first card over reveals the Korean: its sound comes with it.
    if (!flipped && glossFront && audio) playClip(audio);
    setFlipped(!flipped);
  };
  const act = (response) => { if (!busy) onRespond(response); };
  const advance = practice ? () => act({ next: true }) : () => act({ seen: true });
  useWordLadderKeys({
    ' ': flipped && !stream ? advance : flip,
    enter: flipped && !stream ? advance : flip,
    h: () => soundOk && playClip(audio),
    ...(stream ? { u: () => act({ undo: true }), q: () => act({ quizNow: true }) } : {}),
    ...(sorts && flipped ? { 1: () => act({ sort: 'notYet' }), 2: () => act({ sort: 'familiar' }), 3: () => act({ sort: 'claimed' }) } : {}),
  });
  const termFace = <div className="wl-card__face wl-card__face--front"><FitText role="term" text={word.term} lang={langs.term} /></div>;
  const meaningFace = (
    <div className={`wl-card__face wl-card__face--back${image && imageOk ? ' has-picture' : ''}`}>
      {image && imageOk && <img className="wl-card__picture" src={image} alt={word.gloss} onError={() => setImageOk(false)} />}
      <div className="wl-card__gloss"><FitText role="gloss" text={word.gloss} lang={langs.gloss} /></div>
      {word.pronunciation && !glossFront && <p className="wl-card__pron">{word.pronunciation}</p>}
    </div>
  );
  return (
    <section className="wl-item wl-flashcard" aria-label={sorts ? 'Flashcard' : 'New word'}>
      <button type="button" className={`wl-card${flipped ? ' is-flipped' : ''}`} onClick={flip} aria-label={flipped ? 'Flip back' : 'Flip the card'}>
        {termShowing ? termFace : meaningFace}
      </button>
      <div className="wl-controls">
        {soundOk && <TouchButton variant="secondary" keyHint="H" onClick={() => playClip(audio)}><Icon name="volume" /> Hear it</TouchButton>}
        {!flipped && <TouchButton variant="primary" keyHint="Space" onClick={flip}>Flip</TouchButton>}
        {flipped && !stream && <TouchButton variant={practice ? 'secondary' : 'primary'} keyHint="Space" disabled={busy} onClick={advance}>Next</TouchButton>}
        {flipped && sorts && (
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
