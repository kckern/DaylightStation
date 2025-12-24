import React from 'react';
import PropTypes from 'prop-types';
import { AppIconButton } from '../AppIconButton';
import './NumericKeypad.scss';

const NumericKeypad = ({
  value = '',
  onChange,
  onSubmit,
  maxLength = 6,
  allowDecimal = true,
  allowNegative = false,
  placeholder = '0',
  label,
  unit,
  layout = 'standard',
  showBackspace = true,
  showClear = true,
  size = 'md',
  className,
  ...props
}) => {
  const handlePress = (key) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
      return;
    }
    
    if (key === 'clear') {
      onChange('');
      return;
    }

    if (key === 'submit') {
      onSubmit?.();
      return;
    }

    if (value.length >= maxLength) return;

    if (key === '.' && value.includes('.')) return;
    if (key === '.' && !value) {
      onChange('0.');
      return;
    }

    onChange(value + key);
  };

  const keys = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    allowDecimal ? '.' : '', '0', 'backspace'
  ];

  return (
    <div className={`numeric-keypad numeric-keypad--${size} ${className || ''}`} {...props}>
      {(label || value || placeholder) && (
        <div className="numeric-keypad__display">
          {label && <div className="numeric-keypad__label">{label}</div>}
          <div className="numeric-keypad__value-container">
            <span className={`numeric-keypad__value ${!value ? 'placeholder' : ''}`}>
              {value || placeholder}
            </span>
            {unit && <span className="numeric-keypad__unit">{unit}</span>}
          </div>
        </div>
      )}

      <div className="numeric-keypad__grid">
        {keys.map((key, index) => {
          if (!key) return <div key={`empty-${index}`} />;
          
          if (key === 'backspace') {
            return showBackspace ? (
              <button
                key="backspace"
                className="numeric-keypad__key numeric-keypad__key--action"
                onClick={() => handlePress('backspace')}
                aria-label="Backspace"
              >
                ⌫
              </button>
            ) : <div key="empty-bs" />;
          }

          return (
            <button
              key={key}
              className="numeric-keypad__key"
              onClick={() => handlePress(key)}
            >
              {key}
            </button>
          );
        })}
      </div>

      {(showClear || onSubmit) && (
        <div className="numeric-keypad__actions">
          {showClear && (
            <button
              className="numeric-keypad__action-btn numeric-keypad__action-btn--clear"
              onClick={() => handlePress('clear')}
            >
              Clear
            </button>
          )}
          {onSubmit && (
            <button
              className="numeric-keypad__action-btn numeric-keypad__action-btn--submit"
              onClick={() => handlePress('submit')}
              disabled={!value}
            >
              OK
            </button>
          )}
        </div>
      )}
    </div>
  );
};

NumericKeypad.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func,
  maxLength: PropTypes.number,
  allowDecimal: PropTypes.bool,
  allowNegative: PropTypes.bool,
  placeholder: PropTypes.string,
  label: PropTypes.string,
  unit: PropTypes.string,
  layout: PropTypes.oneOf(['standard', 'phone', 'calculator']),
  showBackspace: PropTypes.bool,
  showClear: PropTypes.bool,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  className: PropTypes.string
};

export default NumericKeypad;
