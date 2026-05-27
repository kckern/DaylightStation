import React, { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  TextInput,
  Switch,
  ActionIcon,
  Button,
  Paper,
  Text,
} from '@mantine/core';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';

/**
 * SchedulesSection — continuous time-window schedule CRUD for private devices.
 *
 * Each window is { start: 'HH:MM', end: 'HH:MM', queue: 'source:id', shuffle?: boolean }.
 *
 * The wire field on the device is `continuous` (matches HubDevice.toYaml());
 * the plan doc refers to it as `continuousSchedules` but the actual YAML
 * uses `continuous`, which is what useHubConfig returns.
 *
 * Props:
 *   slot:      device config { color, continuous?: [...], ... }
 *   mutations: object from useHubMutations
 */
export function SchedulesSection({ slot, mutations }) {
  const [windows, setWindows] = useState(() => slot?.continuous ?? []);
  const [saving, setSaving] = useState(false);

  // Re-sync when slot prop changes (e.g. after revalidate)
  useEffect(() => {
    setWindows(slot?.continuous ?? []);
  }, [slot?.continuous]);

  const updateWindow = (idx, patch) => {
    setWindows((prev) => prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  };

  const removeWindow = (idx) => {
    setWindows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addWindow = () => {
    setWindows((prev) => [
      ...prev,
      { start: '', end: '', queue: '', shuffle: false },
    ]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, {
        continuous: windows.map((w) => ({
          start: w.start || '',
          end: w.end || '',
          queue: w.queue || '',
          shuffle: !!w.shuffle,
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      {windows.length === 0 && (
        <Text size="sm" c="dimmed">No continuous windows configured.</Text>
      )}
      {windows.map((w, idx) => (
        <Paper key={idx} withBorder p="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              label="Start"
              value={w.start || ''}
              onChange={(e) => updateWindow(idx, { start: e.currentTarget.value })}
              placeholder="HH:MM"
              w={100}
            />
            <TextInput
              label="End"
              value={w.end || ''}
              onChange={(e) => updateWindow(idx, { end: e.currentTarget.value })}
              placeholder="HH:MM"
              w={100}
            />
            <div style={{ flex: 1, minWidth: 180 }}>
              <Text size="xs" mb={4}>Queue</Text>
              <LabeledContentPicker
                value={w.queue || ''}
                onChange={(id) => updateWindow(idx, { queue: id || '' })}
                placeholder="Pick a queue..."
              />
            </div>
            <Switch
              label="Shuffle"
              checked={!!w.shuffle}
              onChange={(e) => updateWindow(idx, { shuffle: e.currentTarget.checked })}
            />
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => removeWindow(idx)}
              aria-label={`remove window ${idx + 1}`}
              title="Remove window"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}
      <Group justify="space-between">
        <Button
          variant="default"
          leftSection={<IconPlus size={14} />}
          onClick={addWindow}
        >
          Add window
        </Button>
        <Button onClick={handleSave} loading={saving} disabled={saving}>
          Save schedules
        </Button>
      </Group>
    </Stack>
  );
}

export default SchedulesSection;
