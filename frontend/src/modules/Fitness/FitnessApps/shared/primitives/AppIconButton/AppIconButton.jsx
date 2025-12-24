import React from 'react';
import PropTypes from 'prop-types';
import './AppIconButton.scss';

const AppIconButton = ({
  icon,
  variant = 'default',
  size = 'md',
  shape = 'circle',
  badge,
  tooltip,
  disabled = false,
  onClick,
  className,
  ariaLabel,
  type = 'button',
  ...props
}) => {
  const combinedClassName = [
    'app-icon-button',
    `app-icon-button--${variant}`,
    `app-icon-button--${size}`,
    `app-icon-button--${shape}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={combinedClassName}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      title={tooltip}
      {...props}
    >
      <span className="app-icon-button__icon">{icon}</span>
      {badge && (
        <span className="app-icon-button__badge">
          {badge}
        </span>
      )}
    </button>
  );
};

AppIconButton.propTypes = {
  icon: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['default', 'primary', 'danger', 'success', 'ghost']),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  shape: PropTypes.oneOf(['circle', 'square']),
  badge: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  tooltip: PropTypes.string,
  disabled: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string,
  ariaLabel: PropTypes.string.isRequired,
  type: PropTypes.oneOf(['button', 'submit', 'reset'])
};

export default AppIconButton;
