import React from 'react';
import { Group, Button, Badge, Text } from '@mantine/core';
import { IconDeviceFloppy, IconArrowBack } from '@tabler/icons-react';

/**
 * SaveBar — shared save/revert action bar for admin editors (audit C5).
 *
 * Single source of the "title + Unsaved badge + Revert/Save" chrome so
 * editors don't hand-roll their own. Used by ConfigFormWrapper and by
 * editors with bespoke data flows (e.g. MemberEditor).
 *
 * Props:
 *   title       - Page title (node or string)
 *   dirty       - Unsaved changes present
 *   saving      - Save in flight
 *   onSave      - Save handler
 *   onRevert    - Revert handler
 *   headerExtra - Optional node rendered in the bar, before Revert/Save
 */
function SaveBar({ title, dirty, saving, onSave, onRevert, headerExtra }) {
  return (
    <Group
      justify="space-between"
      className={`ds-action-bar${dirty ? ' ds-action-bar--dirty' : ''}`}
    >
      <Group gap="xs">
        <Text fw={600} size="lg" ff="var(--ds-font-mono)">{title}</Text>
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
          disabled={!dirty || saving}
          size="sm"
        >
          Revert
        </Button>
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={onSave}
          loading={saving}
          disabled={!dirty}
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
