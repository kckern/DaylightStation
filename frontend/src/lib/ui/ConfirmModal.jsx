import { Modal, Stack, Text, Group, Button } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { SubmitButton } from './SubmitButton.jsx';

/** A controlled confirmation. The caller owns the command and its outcome. */
export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  impact,
  confirmLabel = 'Delete',
  loading = false,
  closeOnEscape = true,
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnEscape={closeOnEscape && !loading}
      closeOnClickOutside={!loading}
      closeButtonProps={{ disabled: loading }}
      title={title}
      centered
      size="sm"
      transitionProps={{ transition: 'pop', duration: 150 }}
    >
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
          <SubmitButton as={Button} type="button" color="red" onClick={onConfirm} pending={loading}>
            {confirmLabel}
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}
