import React from 'react';
import PropTypes from 'prop-types';
import './CountdownStoplight.scss';

/**
 * Full-screen stoplight countdown overlay. `remaining` counts down to 0 (GO).
 * Lamp mapping: high third = red, middle third = yellow, 0 = green/GO.
 * Sound is triggered by the caller on each change (kept out of this presentational component).
 */
export default function CountdownStoplight({ remaining, total = 3 }) {
  const isGo = remaining <= 0;
  const frac = total > 0 ? remaining / total : 0;
  const lamp = isGo ? 'green' : frac > 2 / 3 ? 'red' : 'yellow';
  return (
    <div className="countdown-stoplight" data-testid="countdown-stoplight">
      <div className="countdown-stoplight__lamps">
        <span data-testid="lamp-red" className={`countdown-stoplight__lamp countdown-stoplight__lamp--red${lamp === 'red' ? ' is-on' : ''}`} />
        <span data-testid="lamp-yellow" className={`countdown-stoplight__lamp countdown-stoplight__lamp--yellow${lamp === 'yellow' ? ' is-on' : ''}`} />
        <span data-testid="lamp-green" className={`countdown-stoplight__lamp countdown-stoplight__lamp--green${lamp === 'green' ? ' is-on' : ''}`} />
      </div>
      <div className="countdown-stoplight__number" data-testid="countdown-number">
        {isGo ? 'GO' : Math.ceil(remaining)}
      </div>
    </div>
  );
}

CountdownStoplight.propTypes = { remaining: PropTypes.number.isRequired, total: PropTypes.number };
