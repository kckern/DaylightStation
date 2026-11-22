import React from 'react';
import { Group, Button, Badge, Text } from '@mantine/core';
import { IconDeviceFloppy, IconArrowBack } from '@tabler/icons-react';
import { useHotkey } from '../../../lib/hooks/useHotkey.js';

/**
 * SaveBar — shared save/revert action bar for admin editors (audit C5).
 *
 * Owns the title, unsaved state, actions and keyboard shortcuts for Admin
 * editors. Each editor supplies its save and revert operations.
 *
 * Props:
 *   title       - Page title; strings get the standard mono style, nodes render as-is
 *   dirty       - Unsaved changes present
 *   saving      - Save in flight
 *   saveDisabled - Disable Save while leaving Revert available
 *   onSave      - Save handler
 *   onRevert    - Revert handler
 *   headerExtra - Optional node rendered in the bar, before Revert/Save
 */
function SaveBar({ title, dirty, saving, disabled = false, saveDisabled = false, onSave, onRevert, headerExtra }) {
  const canUseActions = dirty && !saving && !disabled;
  const canSave = canUseActions && !saveDisabled;
  const runShortcut = (event, action, enabled) => {
    if (event.shiftKey) return false;
    if (enabled) action();
  };
  useHotkey('mod+s', event => runShortcut(event, onSave, canSave), { code: 'KeyS' });
  useHotkey('mod+z', event => runShortcut(event, onRevert, canUseActions), { code: 'KeyZ' });

  return (
    <Group
      justify="space-between"
      className={`ds-action-bar${dirty ? ' ds-action-bar--dirty' : ''}`}
    >
      <Group gap="xs">
        {typeof title === 'string'
          ? <Text fw={600} size="lg" ff="var(--ds-font-mono)">{title}</Text>
          : title}
        {dirty && (
          <Badge color="yellow" variant="light" size="sm">
            Unsaved
          </Badge>
        )}
      </Group>
      <Group gap="xs">
        {headerExtra}
        <Button
          variant="subtle"
          leftSection={<IconArrowBack size={16} />}
          onClick={onRevert}
          disabled={!canUseActions}
          size="sm"
        >
          Revert
        </Button>
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={onSave}
          loading={saving}
          disabled={!canSave}
          size="sm"
          data-testid="config-save-button"
        >
          Save
        </Button>
      </Group>
    </Group>
  );
}

export default SaveBar;
