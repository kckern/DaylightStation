import React from 'react';
import PropTypes from 'prop-types';
import { AppButton } from '../../primitives';
import './AppNavigation.scss';

const AppNavigation = ({
  variant = 'arrows',
  items,
  activeIndex = 0,
  onChange,
  showBack = true,
  showForward = true,
  backLabel = 'Back',
  forwardLabel = 'Next',
  onBack,
  onForward,
  disableBack = false,
  disableForward = false,
  position = 'bottom',
  className,
  ...props
}) => {
  const combinedClassName = [
    'app-navigation',
    `app-navigation--${variant}`,
    `app-navigation--${position}`,
    className
  ].filter(Boolean).join(' ');

  if (variant === 'stepper' && items) {
    return (
      <div className={combinedClassName} {...props}>
        <div className="app-navigation__steps">
          {items.map((item, index) => {
            const isActive = index === activeIndex;
            const isCompleted = index < activeIndex;
            
            return (
              <div 
                key={index} 
                className={`app-navigation__step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                onClick={() => onChange?.(index)}
              >
                <div className="app-navigation__step-indicator">
                  {isCompleted ? '✓' : index + 1}
                </div>
                <span className="app-navigation__step-label">{item}</span>
                {index < items.length - 1 && <div className="app-navigation__step-line" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={combinedClassName} {...props}>
      {showBack && (
        <AppButton
          variant="secondary"
          onClick={onBack}
          disabled={disableBack}
          icon={<span>←</span>}
          className="app-navigation__back"
        >
          {backLabel}
        </AppButton>
      )}

      <div className="app-navigation__content">
        {variant === 'dots' && items && (
          <div className="app-navigation__dots">
            {items.map((_, index) => (
              <button
                key={index}
                className={`app-navigation__dot ${index === activeIndex ? 'active' : ''}`}
                onClick={() => onChange?.(index)}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {showForward && (
        <AppButton
          variant="primary"
          onClick={onForward}
          disabled={disableForward}
          icon={<span>→</span>}
          iconPosition="right"
          className="app-navigation__forward"
        >
          {forwardLabel}
        </AppButton>
      )}
    </div>
  );
};

AppNavigation.propTypes = {
  variant: PropTypes.oneOf(['arrows', 'tabs', 'breadcrumb', 'stepper', 'dots']),
  items: PropTypes.arrayOf(PropTypes.string),
  activeIndex: PropTypes.number,
  onChange: PropTypes.func,
  showBack: PropTypes.bool,
  showForward: PropTypes.bool,
  backLabel: PropTypes.node,
  forwardLabel: PropTypes.node,
  onBack: PropTypes.func,
  onForward: PropTypes.func,
  disableBack: PropTypes.bool,
  disableForward: PropTypes.bool,
  position: PropTypes.oneOf(['top', 'bottom']),
  className: PropTypes.string
};

export default AppNavigation;
