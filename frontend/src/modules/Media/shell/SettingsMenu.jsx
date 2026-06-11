// frontend/src/modules/Media/shell/SettingsMenu.jsx
import React from 'react';
import { Menu, ActionIcon } from '@mantine/core';
import { IconSettings, IconRestore } from '@tabler/icons-react';

export function SettingsMenu({ onResetSession }) {
  return (
    <Menu position="bottom-end" shadow="md" withinPortal>
      <Menu.Target>
        <ActionIcon aria-label="Settings" data-testid="settings-menu-trigger">
          <IconSettings size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="settings-menu-panel">
        <Menu.Item
          data-testid="settings-reset-session"
          leftSection={<IconRestore size={16} />}
          onClick={onResetSession}
        >
          Reset session
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default SettingsMenu;
