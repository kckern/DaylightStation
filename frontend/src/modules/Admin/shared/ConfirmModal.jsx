import React from 'react';
import { Modal, Stack, Text, Group, Button } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * ConfirmModal - Reusable confirmation dialog for destructive actions.
 *
 * Props:
 * - opened: boolean - whether the modal is visible
 * - onClose: () => void - called when modal is dismissed
 * - onConfirm: () => void - called when confirm button is clicked
 * - title: string - modal title
 * - message: string - body text explaining the action
 * - impact: string - optional yellow warning text (e.g. "2 screens reference this device.")
 * - confirmLabel: string - confirm button text (default "Delete")
 * - loading: boolean - show loading state on confirm button (default false)
 */
function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  impact,
  confirmLabel = 'Delete',
  loading = false
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="sm">
      <Stack gap="md">
        <Text size="sm">{message}</Text>

        {impact && (
          <Group gap={8} wrap="nowrap" align="flex-start">
            <IconAlertTriangle size={18} color="var(--mantine-color-yellow-5)" style={{ flexShrink: 0, marginTop: 2 }} />
            <Text size="sm" c="yellow.5">
              {impact}
            </Text>
          </Group>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ConfirmModal;
