import { Button, Group, Stack, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';

/**
 * A destructive action's last stop.
 *
 * ONE instance, owned by the view — not one per row. A confirm rendered inside
 * every row would mount a dialog, a focus trap and a dismiss-stack registration
 * for each of thirty entries, and the stack is a stack: whichever registered
 * last would answer Escape regardless of which row you tapped.
 *
 * Built on `Sheet` rather than `window.confirm` for the reason the rest of this
 * app is: the browser dialog cannot be styled, reads as a page-level alert on a
 * phone, and steals focus from the row you were looking at. `window.confirm`
 * would also pass the `audit:ui` gate while quietly breaking the house overlay
 * behaviour (scrim dismiss, scroll lock, focus return), so passing the gate is
 * not the bar here.
 *
 * Escape and the scrim mean CANCEL — the safe answer. While the delete is in
 * flight both are inert, so a stray Escape cannot leave a half-finished
 * operation behind an already-dismissed dialog.
 */
export function ConfirmDialog({
  open, title, body, confirmLabel = 'Delete', busy = false, error = null, onConfirm, onCancel,
}) {
  if (!open) return null;
  return <Sheet open onClose={() => { if (!busy) onCancel(); }} title={title}>
    <Stack gap="md">
      <Text size="sm">{body}</Text>
      {error ? <Text size="sm" role="alert" c="red">{error}</Text> : null}
      <Group justify="flex-end" gap="xs">
        <Button size="sm" variant="subtle" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" color="red" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </Group>
    </Stack>
  </Sheet>;
}

export default ConfirmDialog;
