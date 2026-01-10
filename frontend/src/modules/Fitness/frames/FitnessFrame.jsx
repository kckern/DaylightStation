import React from 'react';
import PropTypes from 'prop-types';
import './FitnessFrame.scss';

/**
 * FitnessFrame - Level 0 Layout Shell
 * 
 * Provides the base layout structure for the Fitness module with named slots:
 * - nav: Left navigation bar (FitnessNavbar)
 * - children: Main content area
 * - overlay: Portal target for overlays (rendered absolutely)
 * 
 * This is a pure layout component with no business logic.
 * 
 * @example
 * <FitnessFrame
 *   nav={<FitnessNavbar />}
 *   overlay={<OverlayStack />}
 *   className="custom-class"
 * >
 *   <MainContent />
 * </FitnessFrame>
 */
const FitnessFrame = ({
  nav = null,
  children,
  overlay = null,
  className = '',
  hideNav = false,
  ...props
}) => {
  const rootClasses = [
    'fitness-frame',
    hideNav && 'fitness-frame--nav-hidden',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClasses} {...props}>
      {/* Navigation Slot */}
      {!hideNav && nav && (
        <div className="fitness-frame__nav">
          {nav}
        </div>
      )}

      {/* Main Content Slot */}
      <div className="fitness-frame__main">
        {children}
      </div>

      {/* Overlay Slot (portal target) */}
      {overlay && (
        <div className="fitness-frame__overlay">
          {overlay}
        </div>
      )}
    </div>
  );
};

FitnessFrame.propTypes = {
  /** Navigation component (typically FitnessNavbar) */
  nav: PropTypes.node,
  /** Main content */
  children: PropTypes.node,
  /** Overlay components (rendered absolutely over content) */
  overlay: PropTypes.node,
  /** Additional CSS classes */
  className: PropTypes.string,
  /** Hide the navigation slot */
  hideNav: PropTypes.bool
};

export default FitnessFrame;
