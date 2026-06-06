import React from 'react';
import PropTypes from 'prop-types';
import { DistanceIcon, TimeIcon } from './icons.jsx';
import './HighScores.scss';

/**
 * High scores — clickable personal-best cards above History. Same tap-into-recap
 * affordance as a History row; the metric value is the hero figure.
 */
export function HighScores({ highScores = [], onSelectRecord }) {
  if (highScores.length === 0) return null;
  return (
    <section className="cgh-hs-section" data-testid="cycle-game-highscores">
      <div className="cgh-section-label">High scores</div>
      <div className="cgh-highscores">
        {highScores.map((hs) => (
          <button
            key={hs.key}
            type="button"
            className="cgh-hs"
            data-testid={`highscore-${hs.key}`}
            onClick={() => onSelectRecord?.(hs.raceId)}
            aria-label={`${hs.label}: ${hs.valueLabel} by ${hs.holderName}. View race.`}
          >
            <span className="cgh-hs__icon" aria-hidden="true">
              {hs.key === 'time' ? <TimeIcon /> : <DistanceIcon />}
            </span>
            <span className="cgh-hs__body">
              <span className="cgh-hs__label">{hs.label}</span>
              <span className="cgh-hs__value">{hs.valueLabel}</span>
              {hs.whenDay && (
                <span className="cgh-hs__when">
                  {hs.whenDay}{hs.whenTime ? ` · ${hs.whenTime}` : ''}
                </span>
              )}
            </span>
            <span className="cgh-hs__holder">
              {hs.holderAvatar && (
                <img
                  className="cgh-hs__avatar"
                  src={hs.holderAvatar}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <span className="cgh-hs__name">{hs.holderName}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

HighScores.propTypes = {
  highScores: PropTypes.array,
  onSelectRecord: PropTypes.func
};

export default HighScores;
