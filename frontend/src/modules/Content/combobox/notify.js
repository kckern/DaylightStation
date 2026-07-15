import React from 'react';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

/**
 * Show a transient toast with an Undo action (audit C4). Used for
 * curation-flow deletes where a confirm dialog would be too heavy: the
 * action happens immediately and the user has `timeoutMs` to undo it.
 * Pass a stable `id` so repeated deletes replace rather than stack.
 */
export function showUndoToast({ id, title, message, onUndo, timeoutMs = 7000 }) {
  const notifId = id ?? 'undo-toast';
  notifications.show({
    id: notifId,
    title,
    color: 'gray',
    autoClose: timeoutMs,
    withCloseButton: true,
    message: React.createElement(
      Group,
      { justify: 'space-between', gap: 'sm', wrap: 'nowrap' },
      React.createElement(Text, { size: 'sm' }, message),
      React.createElement(
        Button,
        {
          size: 'xs',
          variant: 'subtle',
          'data-testid': 'undo-toast-button',
          onClick: () => {
            notifications.hide?.(notifId);
            onUndo?.();
          },
        },
        'Undo'
      )
    ),
  });
}

export function notifyWarning({ title, message }) {
  notifications.show({
    title,
    message: message ?? '',
    color: 'yellow',
    autoClose: 7000,
  });
}
