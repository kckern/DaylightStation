import React, { useEffect, useRef } from 'react';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function ConfirmDialog({
  open,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  useDismissable(ref, { open, onDismiss: onCancel });

  useEffect(() => {
    if (open) ref.current?.querySelector('[data-testid="confirm-cancel"]')?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="confirm-backdrop">
      <div
        data-testid="confirm-dialog"
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        ref={ref}
      >
        <div className="confirm-dialog__title">{title}</div>
        <div className="confirm-dialog__message">{message}</div>
        <div className="confirm-dialog__actions">
          <button data-testid="confirm-cancel" className="confirm-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            data-testid="confirm-ok"
            className="confirm-btn confirm-btn--danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
