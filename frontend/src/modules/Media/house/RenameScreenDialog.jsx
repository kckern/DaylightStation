// frontend/src/modules/Media/house/RenameScreenDialog.jsx
// Name (and room) for one screen — this device from Settings, or any screen
// from screen admin (RQ-HOUSE-06, RQ-HOUSE-08). The registry's answers come
// back here, never as a toast: a taken name offers its free suggestion; a
// screen routines use lists them first and needs "Rename anyway" (routines
// follow the screen, so they keep working).
import React, { useEffect, useState } from 'react';
import { Button, Group, List, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useDismissLayer } from '../shell/useDismissLayer.js';

export function RenameScreenDialog({
  open, onClose, title = 'Rename this device', initialName = '', initialRoom = '', withRoom = true,
  onSubmit, nameOf = (id) => id, saveLabel = 'Save device name', testid = 'rename-screen',
}) {
  const [name, setName] = useState(initialName);
  const [room, setRoom] = useState(initialRoom ?? '');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  useDismissLayer(open, onClose, { managed: true });
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setRoom(initialRoom ?? '');
    setAnswer(null);
  }, [open, initialName, initialRoom]);

  const submit = async (extra = {}) => {
    setBusy(true);
    const result = await onSubmit({ name: (extra.name ?? name).trim(), room: room.trim(), ...extra });
    setBusy(false);
    if (result?.ok) { onClose(); return; }
    setAnswer({ ...result, name: (extra.name ?? name).trim() });
    if (extra.name) setName(extra.name);
  };

  return (
    <Modal opened={open} onClose={onClose} title={title} centered>
      <Stack gap="sm" data-testid={`${testid}-dialog`}>
        <TextInput
          label="Name"
          description="Every screen in the house has its own name."
          value={name}
          onChange={(e) => { setName(e.currentTarget.value); setAnswer(null); }}
          data-testid={`${testid}-name`}
          autoFocus
        />
        {withRoom && (
          <TextInput label="Room" value={room} onChange={(e) => setRoom(e.currentTarget.value)} data-testid={`${testid}-room`} />
        )}
        {answer?.code === 'NAME_TAKEN' && (
          <div data-testid={`${testid}-taken`} role="alert">
            <Text size="sm">
              “{answer.name}” is already the name of {answer.heldBy ? nameOf(answer.heldBy) : 'another screen'}.
            </Text>
            {answer.suggestion && (
              <Button mt="xs" variant="light" className="house-action" data-testid={`${testid}-use-suggestion`} onClick={() => submit({ name: answer.suggestion })}>
                Use “{answer.suggestion}”
              </Button>
            )}
          </div>
        )}
        {answer?.code === 'ROUTINES_TARGET' && (
          <div data-testid={`${testid}-routines`} role="alert">
            <Text size="sm">These routines start playback on this screen. They follow the screen, so they keep working after the rename:</Text>
            <List size="sm" mt={4}>
              {(answer.routines ?? []).map((r) => <List.Item key={r.id}>{r.name}</List.Item>)}
            </List>
            <Button mt="xs" className="house-action" data-testid={`${testid}-confirm`} loading={busy} onClick={() => submit({ confirm: true })}>
              Rename anyway
            </Button>
          </div>
        )}
        {answer && !['NAME_TAKEN', 'ROUTINES_TARGET'].includes(answer.code) && (
          <Text size="sm" className="house-tone--failed" role="alert" data-testid={`${testid}-error`}>
            Couldn't save the name. {answer.error ?? ''}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" className="house-action" onClick={onClose}>Cancel</Button>
          <Button
            className="house-action"
            leftSection={<IconDeviceFloppy size={16} aria-hidden />}
            disabled={!name.trim() || answer?.code === 'ROUTINES_TARGET'}
            loading={busy && answer?.code !== 'ROUTINES_TARGET'}
            onClick={() => submit()}
            data-testid={`${testid}-save`}
          >
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default RenameScreenDialog;
