// frontend/src/modules/Media/shell/ConfirmDialog.jsx
import React from 'react';
import { Modal, Button, Group, Text } from '@mantine/core';
import { useDismissLayer } from './DismissStackProvider.jsx';

export function ConfirmDialog({ open, title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  // Mantine Modal closes itself on Escape; register as a managed layer so the
  // shell's base dismiss (view back) is suppressed while open.
  useDismissLayer(open, onCancel, { managed: true });

  return (
    <Modal opened={open} onClose={onCancel} title={title} centered size="sm">
      {/* testid lives on the content (the Modal root has no box) */}
      <div data-testid="confirm-dialog">
        <Text size="sm" mb="md">{message}</Text>
        <Group justify="flex-end" gap="sm">
          <Button data-testid="confirm-cancel" variant="default" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button data-testid="confirm-ok" color="red" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
