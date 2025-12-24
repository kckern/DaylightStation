import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import { AppIconButton } from '../../primitives';
import './AppModal.scss';

const AppModal = ({
  isOpen = false,
  onClose,
  title,
  subtitle,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  backdrop = 'blur',
  position = 'center',
  animation = 'scale',
  footer,
  children,
  className,
  ...props
}) => {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !closeOnEscape || !onClose) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (closeOnBackdrop && onClose && e.target === e.currentTarget) {
      onClose();
    }
  };

  const modalContent = (
    <div 
      className={`app-modal-overlay app-modal-overlay--${backdrop} app-modal-overlay--${position}`}
      onClick={handleBackdropClick}
    >
      <div 
        className={`app-modal app-modal--${size} app-modal--${animation} ${className || ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        ref={modalRef}
        {...props}
      >
        {(title || showCloseButton) && (
          <div className="app-modal__header">
            <div className="app-modal__title-group">
              {title && <h2 id="modal-title" className="app-modal__title">{title}</h2>}
              {subtitle && <p className="app-modal__subtitle">{subtitle}</p>}
            </div>
            {showCloseButton && onClose && (
              <AppIconButton
                icon={<span>×</span>}
                variant="ghost"
                size="sm"
                onClick={onClose}
                ariaLabel="Close modal"
                className="app-modal__close"
              />
            )}
          </div>
        )}
        
        <div className="app-modal__body">
          {children}
        </div>

        {footer && (
          <div className="app-modal__footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(
    modalContent,
    document.body
  );
};

AppModal.Header = ({ children, className }) => (
  <div className={`app-modal__header ${className || ''}`}>{children}</div>
);

AppModal.Body = ({ children, className }) => (
  <div className={`app-modal__body ${className || ''}`}>{children}</div>
);

AppModal.Footer = ({ children, className }) => (
  <div className={`app-modal__footer ${className || ''}`}>{children}</div>
);

AppModal.Actions = ({ children, className }) => (
  <div className={`app-modal__actions ${className || ''}`}>{children}</div>
);

AppModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  title: PropTypes.node,
  subtitle: PropTypes.node,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl', 'fullscreen']),
  closeOnBackdrop: PropTypes.bool,
  closeOnEscape: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  backdrop: PropTypes.oneOf(['blur', 'dim', 'none']),
  position: PropTypes.oneOf(['center', 'top', 'bottom']),
  animation: PropTypes.oneOf(['scale', 'slide-up', 'slide-down', 'fade']),
  footer: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string
};

export default AppModal;
