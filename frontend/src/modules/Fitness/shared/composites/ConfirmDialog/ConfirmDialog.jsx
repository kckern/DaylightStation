import React from 'react';
import PropTypes from 'prop-types';
import AppModal from '../AppModal';
import { AppButton } from '../../primitives';
import './ConfirmDialog.scss';

const ConfirmDialog = ({
  isOpen = false,
  onConfirm,
  onCancel,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  icon,
  loading = false,
  className,
  ...props
}) => {
  const getConfirmVariant = () => {
    switch (variant) {
      case 'danger': return 'danger';
      case 'warning': return 'primary'; // Use primary but styled as warning if needed
      default: return 'primary';
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onCancel}
      size="sm"
      className={`confirm-dialog confirm-dialog--${variant} ${className || ''}`}
      {...props}
    >
      <div className="confirm-dialog__content">
        {icon && <div className="confirm-dialog__icon">{icon}</div>}
        <div className="confirm-dialog__text">
          <h3 className="confirm-dialog__title">{title}</h3>
          {message && <p className="confirm-dialog__message">{message}</p>}
        </div>
      </div>

      <AppModal.Actions>
        <AppButton 
          variant="ghost" 
          onClick={onCancel} 
          disabled={loading}
        >
          {cancelLabel}
        </AppButton>
        <AppButton 
          variant={getConfirmVariant()} 
          onClick={onConfirm} 
          loading={loading}
        >
          {confirmLabel}
        </AppButton>
      </AppModal.Actions>
    </AppModal>
  );
};

ConfirmDialog.propTypes = {
  isOpen: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  title: PropTypes.node,
  message: PropTypes.node,
  confirmLabel: PropTypes.node,
  cancelLabel: PropTypes.node,
  variant: PropTypes.oneOf(['default', 'danger', 'warning']),
  icon: PropTypes.node,
  loading: PropTypes.bool,
  className: PropTypes.string
};

export default ConfirmDialog;
