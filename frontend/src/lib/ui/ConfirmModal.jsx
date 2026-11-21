import { Modal, Stack, Text, Group, Button } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { SubmitButton } from './SubmitButton.jsx';
import { useDismissLayer } from './dismiss/useDismissLayer.js';

/** A controlled confirmation. The caller owns the command and its outcome. */
export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  children,
  impact,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  loading = false,
  closeOnEscape = true,
}) {
  const usesDismissStack = useDismissLayer(opened, onClose, {
    managed: loading || !closeOnEscape,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnEscape={!usesDismissStack && closeOnEscape && !loading}
      closeOnClickOutside={!loading}
      closeButtonProps={{ disabled: loading }}
      title={title}
      centered
      size="sm"
      transitionProps={{ transition: 'pop', duration: 150 }}
    >
      <Stack gap="md">
        {message != null && <Text size="sm">{message}</Text>}
        {children}

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
            {cancelLabel}
          </Button>
          <SubmitButton
            as={Button}
            type="button"
            color="red"
            onClick={onConfirm}
            pending={loading}
            blocked={confirmDisabled}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}
