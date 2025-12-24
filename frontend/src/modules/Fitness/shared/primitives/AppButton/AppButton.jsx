import React from 'react';
import PropTypes from 'prop-types';
import './AppButton.scss';

const AppButton = ({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  onClick,
  className,
  type = 'button',
  ...props
}) => {
  const combinedClassName = [
    'app-button',
    `app-button--${variant}`,
    `app-button--${size}`,
    fullWidth ? 'app-button--full-width' : '',
    loading ? 'app-button--loading' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={combinedClassName}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading && <span className="app-button__loader" />}
      {!loading && icon && iconPosition === 'left' && (
        <span className="app-button__icon app-button__icon--left">{icon}</span>
      )}
      <span className="app-button__content">{children}</span>
      {!loading && icon && iconPosition === 'right' && (
        <span className="app-button__icon app-button__icon--right">{icon}</span>
      )}
    </button>
  );
};

AppButton.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'ghost', 'danger', 'success']),
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  icon: PropTypes.node,
  iconPosition: PropTypes.oneOf(['left', 'right']),
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  fullWidth: PropTypes.bool,
  children: PropTypes.node,
  onClick: PropTypes.func,
  className: PropTypes.string,
  type: PropTypes.oneOf(['button', 'submit', 'reset'])
};

export default AppButton;
