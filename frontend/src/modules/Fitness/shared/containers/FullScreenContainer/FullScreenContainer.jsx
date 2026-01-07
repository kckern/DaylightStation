import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import JumpropeAvatar from '../../../FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx';
import './FullScreenContainer.scss';

const FullScreenContainer = ({
  children,
  background = 'default',
  safeAreas = true,
  showHeader = false,
  headerContent,
  showFooter = false,
  footerContent,
  onExit,
  exitOnEscape = true,
  className,
  // Jumprope props
  jumprope = null,
  ...props
}) => {
  useEffect(() => {
    if (!exitOnEscape || !onExit) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exitOnEscape, onExit]);

  const combinedClassName = [
    'full-screen-container',
    `full-screen-container--bg-${background}`,
    safeAreas ? 'full-screen-container--safe-areas' : '',
    jumprope ? 'full-screen-container--jumprope' : '',
    className
  ].filter(Boolean).join(' ');

  // Extract jumprope data if provided
  const jumpropeData = jumprope ? {
    equipmentId: jumprope.equipmentId || jumprope.id,
    equipmentName: jumprope.name || jumprope.equipmentName || 'Jump Rope',
    rpm: jumprope.cadence ?? jumprope.rpm ?? 0,
    jumps: jumprope.revolutionCount ?? jumprope.jumps ?? 0,
    rpmThresholds: jumprope.rpmThresholds || { min: 10, med: 50, high: 80, max: 120 }
  } : null;

  return (
    <div className={combinedClassName} {...props}>
      {showHeader && (
        <header className="full-screen-container__header">
          {headerContent}
          {onExit && (
            <button 
              className="full-screen-container__close-btn"
              onClick={onExit}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </header>
      )}
      
      <main className="full-screen-container__content">
        {jumpropeData ? (
          <div className="full-screen-jumprope">
            <JumpropeAvatar
              equipmentId={jumpropeData.equipmentId}
              equipmentName={jumpropeData.equipmentName}
              rpm={jumpropeData.rpm}
              jumps={jumpropeData.jumps}
              rpmThresholds={jumpropeData.rpmThresholds}
              size={280}
              className="full-screen-jumprope__avatar"
            />
            <div className="full-screen-jumprope__stats">
              <div className="full-screen-jumprope__stat">
                <span className="full-screen-jumprope__value">{jumpropeData.jumps}</span>
                <span className="full-screen-jumprope__label">jumps</span>
              </div>
              <div className="full-screen-jumprope__stat">
                <span className="full-screen-jumprope__value">{Math.round(jumpropeData.rpm) || '--'}</span>
                <span className="full-screen-jumprope__label">rpm</span>
              </div>
            </div>
            <div className="full-screen-jumprope__name">{jumpropeData.equipmentName}</div>
          </div>
        ) : children}
      </main>

      {showFooter && (
        <footer className="full-screen-container__footer">
          {footerContent}
        </footer>
      )}
    </div>
  );
};

FullScreenContainer.propTypes = {
  children: PropTypes.node,
  background: PropTypes.oneOf(['default', 'dark', 'gradient', 'transparent']),
  safeAreas: PropTypes.bool,
  showHeader: PropTypes.bool,
  headerContent: PropTypes.node,
  showFooter: PropTypes.bool,
  footerContent: PropTypes.node,
  onExit: PropTypes.func,
  exitOnEscape: PropTypes.bool,
  className: PropTypes.string,
  jumprope: PropTypes.shape({
    equipmentId: PropTypes.string,
    id: PropTypes.string,
    name: PropTypes.string,
    equipmentName: PropTypes.string,
    cadence: PropTypes.number,
    rpm: PropTypes.number,
    revolutionCount: PropTypes.number,
    jumps: PropTypes.number,
    rpmThresholds: PropTypes.object
  })
};

export default FullScreenContainer;
