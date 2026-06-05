import React from 'react';
import PropTypes from 'prop-types';
import './CountdownStoplight.scss';

/**
 * Full-screen stoplight countdown overlay. `remaining` counts down to 0 (GO).
 * One distinct beat per lamp on the final three counts: the last three beats are
 * RED → YELLOW → GREEN, and any earlier beats flash all three (a "get set" pre-stage)
 * — so yellow never holds for two beats. Sound is triggered by the caller on each
 * change (kept out of this presentational component).
 */
export default function CountdownStoplight({ remaining, total = 3 }) {
  const isGo = remaining <= 0;
  const n = Math.ceil(remaining);
  const lamp = isGo ? 'green' : n === 1 ? 'yellow' : n === 2 ? 'red' : 'all';
  const isAll = lamp === 'all';
  return (
    <div className={`countdown-stoplight${isGo ? ' is-go' : ''}`} data-testid="countdown-stoplight">
      <div className="countdown-stoplight__eyebrow">{isGo ? 'Race!' : 'Get ready'}</div>

      <div className="countdown-stoplight__stage">
        <div className="countdown-stoplight__ring" aria-hidden="true" />
        {/* key on the value punches the number in on every change */}
        <div
          className="countdown-stoplight__number"
          data-testid="countdown-number"
          key={isGo ? 'go' : n}
        >
          {isGo ? 'GO' : n}
        </div>
      </div>

      <div className="countdown-stoplight__lamps" aria-hidden="true">
        <span data-testid="lamp-red" className={`countdown-stoplight__lamp countdown-stoplight__lamp--red${lamp === 'red' || isAll ? ' is-on' : ''}`} />
        <span data-testid="lamp-yellow" className={`countdown-stoplight__lamp countdown-stoplight__lamp--yellow${lamp === 'yellow' || isAll ? ' is-on' : ''}`} />
        <span data-testid="lamp-green" className={`countdown-stoplight__lamp countdown-stoplight__lamp--green${lamp === 'green' || isAll ? ' is-on' : ''}`} />
      </div>
    </div>
  );
}

CountdownStoplight.propTypes = { remaining: PropTypes.number.isRequired, total: PropTypes.number };
