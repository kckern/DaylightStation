import { useState } from 'react';
import { TouchButton } from '../../../../../lib/ui/index.js';
import Icon from '../../../home/icons/Icon.jsx';

/**
 * The start screen as a launch card (the house's contextual launch card, in
 * the word ladder's stage): poster left; class, unit, today and words learned
 * right; Start under them. Everything comes from `GET …/intro` — read-only, so
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

export default function WordLadderStartCard({ intro, fallbackTitle, onStart, onPosterFailed }) {
  const title = intro?.course?.title || fallbackTitle || 'Words';
  const learned = intro?.progress?.learned ?? null;
  const total = intro?.progress?.total ?? null;
  const hasProgress = Number.isFinite(learned) && Number.isFinite(total) && total > 0;
  const progressText = hasProgress ? `${learned} of ${total} words learned` : null;
  return (
    <div className="wl-item wl-start">
      <Poster src={typeof intro?.poster === 'string' ? intro.poster : null} title={title} onFailed={onPosterFailed} />
      <div className="wl-start__copy">
        <h2 className="wl-start__course">{title}</h2>
        {intro?.unit?.title && <p className="wl-start__unit">{intro.unit.title}</p>}
        {intro?.today?.line && <p className="wl-start__today">{intro.today.line}</p>}
        {hasProgress && (
          <div className="wl-start__progress">
            <span className="wl-start__progress-label">{progressText}</span>
            <div
              className="wl-start__progress-track" role="progressbar" aria-label={progressText}
              aria-valuemin="0" aria-valuemax={total} aria-valuenow={learned}
            >
              <span style={{ transform: `scaleX(${Math.min(1, learned / total)})` }} />
            </div>
          </div>
        )}
        <div className="wl-start__action">
          <TouchButton variant="primary" keyHint="Space" onClick={onStart}>Start</TouchButton>
        </div>
      </div>
    </div>
  );
}
