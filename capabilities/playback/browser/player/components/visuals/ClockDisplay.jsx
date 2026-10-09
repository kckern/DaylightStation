import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

/**
 * ClockDisplay - App visual that shows current time
 * Updates every second to display real-time clock.
 */
export function ClockDisplay({ config = {} }) {
  const {
    format = '12h',
    showSeconds = true,
    showDate = false,
    timezone
  } = config;

  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = useCallback((date) => {
    const options = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: format === '12h',
      ...(showSeconds && { second: '2-digit' }),
      ...(timezone && { timeZone: timezone })
    };
    return date.toLocaleTimeString(undefined, options);
  }, [format, showSeconds, timezone]);

  const formatDate = useCallback((date) => {
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(timezone && { timeZone: timezone })
    };
    return date.toLocaleDateString(undefined, options);
  }, [timezone]);

  return (
    <div
      data-track="visual"
      data-visual-type="clock"
      className="clock-display"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      <div
        style={{
          fontSize: 'min(15vw, 12rem)',
          fontWeight: 200,
          letterSpacing: '-0.02em',
          lineHeight: 1
        }}
      >
        {formatTime(time)}
      </div>
      {showDate && (
        <div
          style={{
            fontSize: 'min(3vw, 2rem)',
            fontWeight: 300,
            marginTop: '1rem',
            opacity: 0.7
          }}
        >
          {formatDate(time)}
        </div>
      )}
    </div>
  );
}

ClockDisplay.propTypes = {
  config: PropTypes.shape({
    format: PropTypes.oneOf(['12h', '24h']),
    showSeconds: PropTypes.bool,
    showDate: PropTypes.bool,
    timezone: PropTypes.string
  })
};

export default ClockDisplay;
