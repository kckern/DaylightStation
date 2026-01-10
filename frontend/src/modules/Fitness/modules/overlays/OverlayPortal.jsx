import React from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import './OverlayPortal.scss';

/**
 * OverlayPortal - Level 2 Module: Overlay rendering container
 * 
 * Renders children into a portal at the body level (or specified container).
 * Handles:
 * - Z-index layering via priority prop
 * - Backdrop rendering
 * - Escape key dismissal
 * 
 * @example
 * <OverlayPortal visible={isOpen} priority="high" onClose={handleClose}>
 *   <MyOverlayContent />
 * </OverlayPortal>
 */
const OverlayPortal = ({
  children,
  visible = false,
  priority = 'normal',
  backdrop = false,
  backdropDismiss = true,
  onClose = null,
  className = '',
  container = null,
  ...props
}) => {
  // Handle escape key
  React.useEffect(() => {
    if (!visible || !onClose) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  // Priority maps to z-index ranges
  const priorityZIndex = {
    low: 900,
    normal: 1000,
    high: 1100,
    critical: 1200
  };

  const zIndex = priorityZIndex[priority] || priorityZIndex.normal;

  const overlayClasses = [
    'overlay-portal',
    `overlay-portal--priority-${priority}`,
    className
  ].filter(Boolean).join(' ');

  const handleBackdropClick = (event) => {
    if (backdrop && backdropDismiss && onClose && event.target === event.currentTarget) {
      onClose();
    }
  };

  const content = (
    <div
      className={overlayClasses}
      style={{ zIndex }}
      onClick={handleBackdropClick}
      {...props}
    >
      {backdrop && <div className="overlay-portal__backdrop" />}
      <div className="overlay-portal__content">
        {children}
      </div>
    </div>
  );

  // Render to specified container or body
  const targetContainer = container || (typeof document !== 'undefined' ? document.body : null);
  
  if (!targetContainer) {
    return content;
  }

  return ReactDOM.createPortal(content, targetContainer);
};

OverlayPortal.propTypes = {
  /** Content to render in the overlay */
  children: PropTypes.node,
  /** Whether the overlay is visible */
  visible: PropTypes.bool,
  /** Priority level affects z-index */
  priority: PropTypes.oneOf(['low', 'normal', 'high', 'critical']),
  /** Show backdrop behind overlay */
  backdrop: PropTypes.bool,
  /** Allow clicking backdrop to dismiss */
  backdropDismiss: PropTypes.bool,
  /** Callback when overlay should close */
  onClose: PropTypes.func,
  /** Additional CSS classes */
  className: PropTypes.string,
  /** Custom container element for portal */
  container: PropTypes.instanceOf(typeof Element !== 'undefined' ? Element : Object)
};

export default OverlayPortal;
