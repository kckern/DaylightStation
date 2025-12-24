import React from 'react';
import PropTypes from 'prop-types';
import { AppButton } from '../../primitives';
import './ActionBar.scss';

const ActionBar = ({
  position = 'bottom',
  variant = 'solid',
  primaryAction,
  secondaryActions = [],
  leftContent,
  rightContent,
  safeArea = true,
  className,
  ...props
}) => {
  const combinedClassName = [
    'action-bar',
    `action-bar--${position}`,
    `action-bar--${variant}`,
    safeArea ? 'action-bar--safe-area' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} {...props}>
      <div className="action-bar__content">
        <div className="action-bar__left">
          {leftContent}
          {secondaryActions.map((action, index) => (
            <AppButton
              key={index}
              variant="secondary"
              size="md"
              {...action}
            >
              {action.label}
            </AppButton>
          ))}
        </div>

        <div className="action-bar__center">
          {primaryAction && (
            <AppButton
              variant="primary"
              size="lg"
              {...primaryAction}
              className="action-bar__primary-btn"
            >
              {primaryAction.label}
            </AppButton>
          )}
        </div>

        <div className="action-bar__right">
          {rightContent}
        </div>
      </div>
    </div>
  );
};

ActionBar.propTypes = {
  position: PropTypes.oneOf(['top', 'bottom']),
  variant: PropTypes.oneOf(['solid', 'transparent', 'blur']),
  primaryAction: PropTypes.shape({
    label: PropTypes.node.isRequired,
    onClick: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    loading: PropTypes.bool,
    icon: PropTypes.node
  }),
  secondaryActions: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.node.isRequired,
    onClick: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    icon: PropTypes.node
  })),
  leftContent: PropTypes.node,
  rightContent: PropTypes.node,
  safeArea: PropTypes.bool,
  className: PropTypes.string
};

export default ActionBar;
