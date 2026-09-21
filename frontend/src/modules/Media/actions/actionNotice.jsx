import React from 'react';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';

/** Show Undo at tap time, including while the owner's ACK is outstanding. */
export function offerActionUndo({ operationId, targetName, title, undo, expiresAt = Date.now() + 10000 }) {
  const id = `media-undo-${operationId}`;
  notifications.show({
    id, title: `${title ?? 'Queue change'} · ${targetName}`, autoClose: Math.max(1, expiresAt - Date.now()),
    message: <Button size="xs" variant="subtle" data-testid="item-action-undo" onClick={async () => {
      try {
        const result = await undo(operationId);
        if (result?.ok === false) throw new Error(result.reason ?? result.code);
        notifications.hide(id);
      } catch (error) {
        notifications.show({ id: `${id}-failed`, color: 'red', title: 'Could not undo', message: error.message });
      }
    }}>Undo</Button>,
  });
}
