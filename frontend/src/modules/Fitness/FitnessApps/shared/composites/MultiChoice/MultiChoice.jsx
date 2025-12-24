import React from 'react';
import PropTypes from 'prop-types';
import './MultiChoice.scss';

const MultiChoice = ({
  options,
  value,
  onChange,
  multiSelect = false,
  layout = 'vertical',
  columns = 2,
  size = 'md',
  variant = 'cards',
  showIcons = true,
  showCheckmarks = true,
  disabled = false,
  className,
  ...props
}) => {
  const handleSelect = (optionValue) => {
    if (disabled) return;

    if (multiSelect) {
      const currentValues = Array.isArray(value) ? value : [];
      const newValues = currentValues.includes(optionValue)
        ? currentValues.filter(v => v !== optionValue)
        : [...currentValues, optionValue];
      onChange(newValues);
    } else {
      onChange(optionValue);
    }
  };

  const isSelected = (optionValue) => {
    if (multiSelect) {
      return Array.isArray(value) && value.includes(optionValue);
    }
    return value === optionValue;
  };

  const combinedClassName = [
    'multi-choice',
    `multi-choice--${layout}`,
    `multi-choice--${variant}`,
    `multi-choice--${size}`,
    className
  ].filter(Boolean).join(' ');

  const style = layout === 'grid' ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : {};

  return (
    <div className={combinedClassName} style={style} role="group" {...props}>
      {options.map((option) => {
        const selected = isSelected(option.value);
        const optionDisabled = disabled || option.disabled;
        
        return (
          <button
            key={option.value}
            className={`multi-choice__option ${selected ? 'selected' : ''}`}
            onClick={() => handleSelect(option.value)}
            disabled={optionDisabled}
            aria-pressed={selected}
          >
            {showIcons && option.icon && (
              <span className="multi-choice__icon">{option.icon}</span>
            )}
            
            <div className="multi-choice__content">
              <span className="multi-choice__label">{option.label}</span>
              {option.description && (
                <span className="multi-choice__description">{option.description}</span>
              )}
            </div>

            {showCheckmarks && selected && (
              <span className="multi-choice__checkmark">✓</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

MultiChoice.propTypes = {
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.any.isRequired,
    label: PropTypes.node.isRequired,
    icon: PropTypes.node,
    description: PropTypes.node,
    disabled: PropTypes.bool
  })).isRequired,
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  multiSelect: PropTypes.bool,
  layout: PropTypes.oneOf(['vertical', 'horizontal', 'grid']),
  columns: PropTypes.number,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  variant: PropTypes.oneOf(['cards', 'buttons', 'chips', 'radio']),
  showIcons: PropTypes.bool,
  showCheckmarks: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string
};

export default MultiChoice;
