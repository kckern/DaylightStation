// frontend/src/modules/Media/shell/SettingsMenu.jsx
// This device's settings: its name and room (through the household screen
// registry, RQ-HOUSE-06), the way into screen admin (RQ-HOUSE-08) and
// routine history (RQ-AUTO-05), and Start fresh.
import React, { useCallback, useRef, useState } from 'react';
import { Menu, ActionIcon } from '@mantine/core';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { IconDevices, IconEdit, IconHistory, IconSettings, IconRestore } from '@tabler/icons-react';
import { useClientIdentity } from "../identity/useClientIdentity.js";
import { useFleetContext } from "../fleet/useFleetContext.js";
import { useNav } from "./NavProvider.jsx";
import { RenameScreenDialog } from "../house/RenameScreenDialog.jsx";

export function SettingsMenu({ onResetSession }) {
  const identity = useClientIdentity();
  const { devices, registry } = useFleetContext();
  const { push } = useNav();
  const settingsRef = useRef(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const closeRename = useCallback(() => setRenameOpen(false), []);
  const openDialog = (open) => {
    // The menu item leaves the DOM. Return focus to the Settings trigger.
    settingsRef.current?.focus({ preventScroll: true });
    open?.();
  };
  const nameOf = (id) => registry?.byId?.get?.(id)?.name
    ?? devices.find((device) => device.id === id || device.screenId === id)?.name
    ?? 'another screen';
  const submit = (input) => identity.rename({
    ...input,
    existingNames: devices.filter(device => device.id !== identity.deviceId).map(device => device.name),
  });
  return (
    <>
      <ActionMenu
        trigger={
          <ActionIcon ref={settingsRef} aria-label="Settings" data-testid="settings-menu-trigger">
            <IconSettings size={20} />
          </ActionIcon>
        }
        dropdownProps={{ 'data-testid': 'settings-menu-panel' }}
        position="bottom-end"
        shadow="md"
        withinPortal
      >
        <Menu.Item data-testid="settings-rename-device" leftSection={<IconEdit size={16} />} onClick={() => openDialog(() => setRenameOpen(true))}>
          Rename this device
        </Menu.Item>
        <Menu.Item data-testid="settings-manage-screens" leftSection={<IconDevices size={16} />} onClick={() => push('screens', {})}>
          Screens in the house
        </Menu.Item>
        <Menu.Item data-testid="settings-routine-history" leftSection={<IconHistory size={16} />} onClick={() => push('routines', {})}>
          Routine history
        </Menu.Item>
        <Menu.Item
          data-testid="settings-reset-session"
          leftSection={<IconRestore size={16} />}
          onClick={() => openDialog(onResetSession)}
        >
          Start fresh
        </Menu.Item>
      </ActionMenu>
      <RenameScreenDialog
        open={renameOpen}
        onClose={closeRename}
        title="Rename this device"
        initialName={identity.name}
        initialRoom={identity.room ?? ''}
        onSubmit={submit}
        nameOf={nameOf}
        testid="settings-rename"
      />
    </>
  );
}

export default SettingsMenu;
