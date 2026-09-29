// frontend/src/modules/Media/shell/SettingsMenu.jsx
import React, { useEffect, useState } from 'react';
import { Menu, ActionIcon, Button, Group, Modal, TextInput } from '@mantine/core';
import { IconDeviceFloppy, IconEdit, IconSettings, IconRestore } from '@tabler/icons-react';
import { useClientIdentity } from '../identity/useClientIdentity.js';
import { useFleetContext } from '../fleet/useFleetContext.js';

export function SettingsMenu({ onResetSession }) {
  const identity = useClientIdentity();
  const { devices } = useFleetContext();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(identity.name);
  const [room, setRoom] = useState(identity.room ?? '');
  useEffect(() => { setName(identity.name); setRoom(identity.room ?? ''); }, [identity.name, identity.room]);
  const save = () => {
    identity.rename({
      name,
      room,
      existingNames: devices.filter(device => device.id !== identity.deviceId).map(device => device.name),
    });
    setRenameOpen(false);
  };
  return (
    <>
      <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target>
          <ActionIcon aria-label="Settings" data-testid="settings-menu-trigger">
            <IconSettings size={20} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown data-testid="settings-menu-panel">
          <Menu.Item data-testid="settings-rename-device" leftSection={<IconEdit size={16} />} onClick={() => setRenameOpen(true)}>
            Rename this device
          </Menu.Item>
          <Menu.Item
            data-testid="settings-reset-session"
            leftSection={<IconRestore size={16} />}
            onClick={onResetSession}
          >
            Start fresh
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={renameOpen} onClose={() => setRenameOpen(false)} title="Rename this device" centered>
        <TextInput label="Device name" value={name} onChange={event => setName(event.currentTarget.value)} autoFocus />
        <TextInput label="Room" value={room} onChange={event => setRoom(event.currentTarget.value)} mt="sm" />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} disabled={!name.trim()} onClick={save}>Save device name</Button>
        </Group>
      </Modal>
    </>
  );
}

export default SettingsMenu;
