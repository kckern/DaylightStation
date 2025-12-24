import React from 'react';
import PropTypes from 'prop-types';
import { AppButton } from '../../primitives';
import './TreasureBoxWidget.scss';

const TreasureBoxWidget = ({
  isOpen = false,
  onOpen,
  rewards = [],
  title = 'Treasure Box',
  description = 'Open to claim your rewards!',
  className,
  ...props
}) => {
  return (
    <div className={`treasure-box-widget ${isOpen ? 'open' : ''} ${className || ''}`} {...props}>
      <div className="treasure-box-widget__chest-container">
        <div className="treasure-box-widget__chest" onClick={!isOpen ? onOpen : undefined}>
          <div className="treasure-box-widget__chest-lid"></div>
          <div className="treasure-box-widget__chest-base"></div>
          <div className="treasure-box-widget__chest-lock"></div>
        </div>
        
        {isOpen && (
          <div className="treasure-box-widget__glow"></div>
        )}
      </div>

      <div className="treasure-box-widget__content">
        <h3 className="treasure-box-widget__title">{title}</h3>
        {!isOpen ? (
          <p className="treasure-box-widget__description">{description}</p>
        ) : (
          <div className="treasure-box-widget__rewards">
            {rewards.map((reward, index) => (
              <div 
                key={index} 
                className="treasure-box-widget__reward"
                style={{ animationDelay: `${index * 0.2}s` }}
              >
                <div className="treasure-box-widget__reward-icon">{reward.icon}</div>
                <div className="treasure-box-widget__reward-label">{reward.label}</div>
              </div>
            ))}
          </div>
        )}
        
        {!isOpen && onOpen && (
          <AppButton 
            variant="primary" 
            onClick={onOpen}
            className="treasure-box-widget__open-btn"
          >
            Open
          </AppButton>
        )}
      </div>
    </div>
  );
};

TreasureBoxWidget.propTypes = {
  isOpen: PropTypes.bool,
  onOpen: PropTypes.func,
  rewards: PropTypes.arrayOf(PropTypes.shape({
    icon: PropTypes.node,
    label: PropTypes.string
  })),
  title: PropTypes.string,
  description: PropTypes.string,
  className: PropTypes.string
};

export default TreasureBoxWidget;
