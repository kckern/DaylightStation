import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';

/**
 * 2.1 flashcard. Front: the Korean only (text + sound) — never the picture or
 * the English, which ARE the answer. Back: picture and/or English (0.2 reveal).
 * `mode: 'intro'` (0.1, one Next) or `'stream'` (2.1, three sort tones).
 * `mode: 'practice'` (practice menu): `item.front` picks the side facing up —
 * `'gloss'` swaps the faces, so the Korean (and its sound) is the answer and
 * waits for the flip. Flipped: sort 1/2/3 as in the stream, or Next `{next:true}`.
 *
 * THE FLIP is a real 3D turn of the card surface: both faces are mounted, back
 * to back (`backface-visibility: hidden`), and `.wl-card__inner` rotates Y
 * 0→180° on the motion tokens. Only `transform` animates; `will-change` is on
 * only while a turn is in flight (`is-flipping`, cleared on transitionend).
 * The face that is turned away is `aria-hidden` and `visibility: hidden` (the
 * visibility flip is itself transitioned so the leaving face stays drawn for
 * the turn) — so the picture/meaning on the back of a Korean front is neither
 * seen nor read before the flip. Reduced motion: `wl-card--still`, an
 * instant swap with no transition and no will-change.
 */
export default function FlashcardItem({ item, langs, resolveAssetUrl, onRespond, busy = false, onLayout }) {
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
  const shownAt = useRef(Date.now());
  const [still] = useState(prefersReducedMotion);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    setFlipped(false); setImageOk(true); shownAt.current = Date.now();
    if (audio && !glossFront) playClip(audio, 'term', { trigger: 'auto' });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = () => {
    // Turning a meaning-first card over reveals the Korean: its sound comes with it.
    if (!flipped && glossFront && audio) playClip(audio, 'term');
    wordLadderLog.cardFlipped({ itemId: item.id, ms: Date.now() - shownAt.current });
    if (!still) setFlipping(true);
    setFlipped(!flipped);
  };
  // The sides' own visibility transitions bubble here too: only the inner's
  // transform ends the turn. A turn that never reports its end (hidden tab,
  // interrupted) still drops will-change after a beat.
  const flipEnded = (event) => {
    if (event.target === event.currentTarget && (!event.propertyName || event.propertyName === 'transform')) setFlipping(false);
  };
  useEffect(() => {
    if (!flipping) return undefined;
    const timer = setTimeout(() => setFlipping(false), 1000);
    return () => clearTimeout(timer);
  }, [flipping, flipped]);
  const act = (response) => {
    if (busy) return;
    if (response.sort) wordLadderLog.cardSorted({ itemId: item.id, pile: response.sort });
    if (response.undo) wordLadderLog.cardUndone({ itemId: item.id });
    onRespond(response);
  };
  const advance = practice ? () => act({ next: true }) : () => act({ seen: true });
  // Tab = hear it again; H stays a silent alias (not a typing item).
  const hear = () => soundOk && playClip(audio, 'term');
  useWordLadderKeys({
    ' ': flipped && !stream ? advance : flip,
    enter: flipped && !stream ? advance : flip,
    tab: hear,
    h: hear,
    ...(stream ? { u: () => act({ undo: true }), q: () => act({ quizNow: true }) } : {}),
    ...(sorts && flipped ? { 1: () => act({ sort: 'notYet' }), 2: () => act({ sort: 'familiar' }), 3: () => act({ sort: 'claimed' }) } : {}),
  });
  const termFace = <div className="wl-card__face wl-card__face--front"><FitText role="term" text={word.term} lang={langs.term} onFit={onLayout} /></div>;
  const meaningFace = (
    <div className={`wl-card__face wl-card__face--back${image && imageOk ? ' has-picture' : ''}`}>
      {image && imageOk && <img className="wl-card__picture" src={image} alt={word.gloss} onError={() => setImageOk(false)} />}
      <div className="wl-card__gloss"><FitText role="gloss" text={word.gloss} lang={langs.gloss} /></div>
      {word.pronunciation && !glossFront && <p className="wl-card__pron">{word.pronunciation}</p>}
    </div>
  );
  // Up = the face the card starts on; down = the one the flip reveals.
  const upFace = glossFront ? meaningFace : termFace;
  const downFace = glossFront ? termFace : meaningFace;
  const cardClass = ['wl-card', flipped && 'is-flipped', flipping && 'is-flipping', still && 'wl-card--still'].filter(Boolean).join(' ');
  return (
    <section className="wl-item wl-flashcard" aria-label={sorts ? 'Flashcard' : 'New word'}>
      <button type="button" className={cardClass} onClick={flip} aria-label={flipped ? 'Flip back' : 'Flip the card'} data-term-showing={termShowing}>
        <span className="wl-card__inner" onTransitionEnd={flipEnded} onTransitionCancel={flipEnded}>
          <span className="wl-card__side wl-card__side--up" aria-hidden={flipped}>{upFace}</span>
          <span className="wl-card__side wl-card__side--down" aria-hidden={!flipped}>{downFace}</span>
        </span>
      </button>
      <div className="wl-controls">
        {soundOk && <TouchButton variant="secondary" keyHint="Tab" onClick={hear}><Icon name="volume" /> Hear it</TouchButton>}
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

function prefersReducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { return false; }
}
