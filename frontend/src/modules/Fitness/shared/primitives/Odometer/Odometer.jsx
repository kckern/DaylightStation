import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import './Odometer.scss';

const Odometer = ({
  value = 0,
  format = 'integer',
  decimals = 0,
  duration = 500,
  easing = 'ease-out',
  prefix,
  suffix,
  padDigits = 0,
  size = 'md',
  theme = 'default',
  className,
  ...props
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const startValue = useRef(value);
  const startTime = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    startValue.current = displayValue;
    startTime.current = null;
    
    const animate = (timestamp) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      
      const current = startValue.current + (value - startValue.current) * ease;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const formatNumber = (num) => {
    if (format === 'time') {
      const m = Math.floor(num / 60);
      const s = Math.floor(num % 60);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    
    let formatted = num.toFixed(decimals);
    if (format === 'currency') {
      formatted = Number(formatted).toLocaleString();
    }
    
    if (padDigits > 0) {
      const [int, dec] = formatted.split('.');
      const paddedInt = int.padStart(padDigits, '0');
      return dec ? `${paddedInt}.${dec}` : paddedInt;
    }
    
    return formatted;
  };

  const combinedClassName = [
    'app-odometer',
    `app-odometer--${size}`,
    `app-odometer--${theme}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} {...props}>
      {prefix && <span className="app-odometer__prefix">{prefix}</span>}
      <span className="app-odometer__value">{formatNumber(displayValue)}</span>
      {suffix && <span className="app-odometer__suffix">{suffix}</span>}
    </div>
  );
};

Odometer.propTypes = {
  value: PropTypes.number,
  format: PropTypes.oneOf(['integer', 'decimal', 'currency', 'time']),
  decimals: PropTypes.number,
  duration: PropTypes.number,
  easing: PropTypes.string,
  prefix: PropTypes.node,
  suffix: PropTypes.node,
  padDigits: PropTypes.number,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl', '2xl']),
  theme: PropTypes.oneOf(['default', 'neon', 'retro', 'minimal']),
  className: PropTypes.string
};

export default Odometer;
