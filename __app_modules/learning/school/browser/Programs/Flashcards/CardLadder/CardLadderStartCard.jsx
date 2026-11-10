import { useState } from 'react';
import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";

/**
 * The start screen as a launch card (the house's contextual launch card, in
 * the card ladder's stage): poster left; class, unit, today and the deck's
 * two rungs (recognised · mastered) right; Start under them. Everything comes from `GET …/intro` — read-only, so
 * nothing is opened before Start (spec §6).
 *
 * The poster follows the house rule: the server's URL or nothing, and a poster
 * that is missing or fails to load draws a calm placeholder — never a
 * substitute image. Until (or unless) the facts arrive, the card still says
 * what it can (the descriptor's title) and Start works.
 */
function Poster({ src, title, onFailed }) {
  // Which src failed, not a flag reset by an effect: a reset effect that
  // flushes AFTER a fast onError would put the broken poster straight back.
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src || failedSrc === src) {
    return (
      <div className="wl-start__poster wl-start__poster--placeholder" data-testid="wl-start-poster-placeholder" aria-hidden="true">
        <Icon name="kind-deck" />
      </div>
    );
  }
  return (
    <img
      className="wl-start__poster" src={src} alt={`${title} poster`}
      onError={() => { setFailedSrc(src); onFailed?.(); }}
    />
  );
}

/**
 * Two rungs, not one: "mastered" (typed sign-off) takes weeks, so a card that
 * counted only it would read "0 of 19" long after the child knows words.
 * Recognised words (verified, not yet signed off) show from the first quiz.
 */
export function startCardProgress(progress) {
  const total = progress?.total;
  const mastered = progress?.learned;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(mastered)) return null;
  const recognised = Number.isFinite(progress?.recognised) ? progress.recognised : 0;
  return { total, mastered, recognised, text: `${recognised} recognised · ${mastered} mastered of ${total}` };
}

/**
 * The week's dictation on the start card (spec 2026-11-06; UX audit
 * placement 3): a button beside Start while words are left — the primary one
 * once the day's goal is done — or a "ready" line once every word is. A file
 * a grown-up must fix is said plainly; nothing is shown with no week tagged.
 */
export function dictationOffer(dictation) {
  if (!dictation) return null;
  if (dictation.unavailable) return { kind: 'note', text: 'Dictation needs a grown-up to fix it' };
  // A finished week can be reviewed (spec Goals; final review I2).
  if (dictation.done) return { kind: 'ready', text: 'Dictation ready ✓', action: 'Review dictation' };
  // Words left only for a grown-up are said, never hidden (final review I3).
  const waiting = (dictation.needsRecording ?? []).length + (dictation.unknown ?? []).length;
  if (!(dictation.remaining > 0)) {
    return waiting ? { kind: 'note', text: `Dictation: ${waiting} ${waiting === 1 ? 'word' : 'words'} waiting for a grown-up` } : null;
  }
  return { kind: 'drill', text: `Dictation: ${dictation.remaining} ${dictation.remaining === 1 ? 'word' : 'words'}` };
}

export default function CardLadderStartCard({ intro, fallbackTitle, onStart, onDictation = null, onReview = null, onPosterFailed }) {
  const offer = onDictation ? dictationOffer(intro?.dictation) : null;
  const dayDone = Boolean(intro?.today?.doneToday);
  const title = intro?.course?.title || fallbackTitle || 'Words';
  const progress = startCardProgress(intro?.progress);
  const pct = (n) => `${Math.min(100, (n / (progress?.total || 1)) * 100)}%`;
  return (
    <div className="wl-item wl-start">
      <Poster src={typeof intro?.poster === 'string' ? intro.poster : null} title={title} onFailed={onPosterFailed} />
      <div className="wl-start__copy">
        <h2 className="wl-start__course">{title}</h2>
        {intro?.unit?.title && <p className="wl-start__unit">{intro.unit.title}</p>}
        {intro?.today?.line && <p className="wl-start__today">{intro.today.line}</p>}
        {progress && (
          <div className="wl-start__progress">
            <span className="wl-start__progress-label">{progress.text}</span>
            <div
              className="wl-start__progress-track" role="progressbar" aria-label={progress.text}
              aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.mastered} aria-valuetext={progress.text}
            >
              <span className="wl-start__progress-mastered" style={{ width: pct(progress.mastered) }} />
              <span className="wl-start__progress-recognised" style={{ width: pct(progress.recognised) }} />
            </div>
          </div>
        )}
        {offer && offer.kind !== 'drill' && <p className="wl-start__dictation" role="status">{offer.text}</p>}
        <div className="wl-start__action">
          <TouchButton variant={offer?.kind === 'drill' && dayDone ? 'secondary' : 'primary'} keyHint="Space" onClick={onStart}>Start</TouchButton>
          {offer?.kind === 'drill' && (
            <TouchButton variant={dayDone ? 'primary' : 'secondary'} keyHint="D" onClick={() => onDictation(false)}>{offer.text}</TouchButton>
          )}
          {offer?.kind === 'ready' && (
            <TouchButton variant="secondary" keyHint="D" onClick={() => onDictation(true)}>{offer.action}</TouchButton>
          )}
          {/* Review is open anytime, goal or not (owner, 2026-11-06). */}
          {onReview && <TouchButton variant="secondary" keyHint="R" onClick={onReview}>Review flashcards</TouchButton>}
        </div>
      </div>
    </div>
  );
}
