import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
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
    className
  ].filter(Boolean).join(' ');

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
        {children}
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
  className: PropTypes.string
};

export default FullScreenContainer;
