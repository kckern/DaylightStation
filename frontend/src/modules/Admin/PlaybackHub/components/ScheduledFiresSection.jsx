import React, { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  TextInput,
  NumberInput,
  Checkbox,
  Chip,
  ActionIcon,
  Button,
  Paper,
  Text,
} from '@mantine/core';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';
import ConfirmModal from '../../shared/ConfirmModal.jsx';

const DAY_PRESETS = ['all', 'weekdays', 'weekends'];

/**
 * Generate a stable id for a new fire. crypto.randomUUID() if available,
 * otherwise a timestamp+random fallback for older test runners.
 */
function newFireId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `fire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize wire shape (snake_case from useHubConfig) into local form state.
 */
function fromWire(fire) {
  return {
    id: fire.id,
    time: fire.time || '',
    days: typeof fire.days === 'string' ? fire.days : (Array.isArray(fire.days) ? 'all' : 'weekdays'),
    target: fire.target,
    queue: fire.queue || '',
    indefinite: fire.duration_min === undefined || fire.duration_min === null,
    durationMin: fire.duration_min ?? 30,
    volumeOverride: fire.volume_override ?? null,
  };
}

/**
 * ScheduledFiresSection — one-shot scheduled-fire CRUD targeted at THIS device.
 *
 * Each row exposes time + days chip-group + queue picker + indefinite checkbox
 * + duration_min NumberInput (disabled when indefinite) + volume_override
 * NumberInput (clamped to slotMaxVolume) + delete button. Delete opens a
 * ConfirmModal. The id of a new fire is generated client-side via crypto.randomUUID.
 *
 * Wire-shape mapping: incoming fires use snake_case (duration_min, volume_override);
 * outgoing saveFire payload uses camelCase (durationMin, volumeOverride) per the
 * SaveScheduledFire use case input shape.
 *
 * Props:
 *   target:        device color
 *   fires:         array of fire objects filtered to this target (wire shape)
 *   slotMaxVolume: clamp for volume override NumberInput
 *   mutations:     object from useHubMutations
 */
export function ScheduledFiresSection({ target, fires, slotMaxVolume, mutations }) {
  const [rows, setRows] = useState(() => (fires ?? []).map(fromWire));
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null });
  const [savingId, setSavingId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Re-sync local state when fires prop changes (e.g. after revalidate)
  useEffect(() => {
    setRows((fires ?? []).map(fromWire));
  }, [fires]);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: null, // assigned at save
        time: '',
        days: 'weekdays',
        target,
        queue: '',
        indefinite: false,
        durationMin: 30,
        volumeOverride: null,
      },
    ]);
  };

  const handleSave = async (idx) => {
    const row = rows[idx];
    const id = row.id || newFireId();
    setSavingId(idx);
    try {
      await mutations.saveFire({
        id,
        time: row.time,
        days: row.days,
        target: row.target || target,
        queue: row.queue,
        durationMin: row.indefinite ? null : Number(row.durationMin) || null,
        volumeOverride: row.volumeOverride == null ? null : Number(row.volumeOverride),
      });
      updateRow(idx, { id });
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteClick = (id) => {
    setConfirmDelete({ open: true, id });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete.id) return;
    setDeleting(true);
    try {
      await mutations.deleteFire(confirmDelete.id);
    } finally {
      setDeleting(false);
      setConfirmDelete({ open: false, id: null });
    }
  };

  return (
    <Stack gap="sm">
      {rows.length === 0 && (
        <Text size="sm" c="dimmed">No scheduled fires for this device.</Text>
      )}
      {rows.map((r, idx) => (
        <Paper key={r.id || `new-${idx}`} withBorder p="sm">
          <Stack gap="xs">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <TextInput
                label="Time"
                value={r.time || ''}
                onChange={(e) => updateRow(idx, { time: e.currentTarget.value })}
                placeholder="HH:MM"
                w={100}
              />
              <div style={{ flex: 1, minWidth: 200 }}>
                <Text size="xs" mb={4}>Queue</Text>
                <LabeledContentPicker
                  value={r.queue || ''}
                  onChange={(id) => updateRow(idx, { queue: id || '' })}
                  placeholder="Pick a queue..."
                />
              </div>
            </Group>
            <Group gap="sm">
              <Text size="xs">Days:</Text>
              <Chip.Group
                multiple={false}
                value={r.days}
                onChange={(v) => updateRow(idx, { days: v })}
              >
                <Group gap="xs">
                  {DAY_PRESETS.map((d) => (
                    <Chip key={d} value={d} size="xs">{d}</Chip>
                  ))}
                </Group>
              </Chip.Group>
            </Group>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Checkbox
                label="Indefinite"
                checked={!!r.indefinite}
                onChange={(e) =>
                  updateRow(idx, { indefinite: e.currentTarget.checked })
                }
              />
              <NumberInput
                label="Duration (min)"
                value={r.durationMin ?? 0}
                onChange={(v) => updateRow(idx, { durationMin: Number(v) || 0 })}
                disabled={!!r.indefinite}
                min={1}
                max={1440}
                w={140}
              />
              <NumberInput
                label="Volume override"
                value={r.volumeOverride ?? ''}
                onChange={(v) =>
                  updateRow(idx, {
                    volumeOverride: v === '' || v === null ? null : Number(v),
                  })
                }
                min={0}
                max={slotMaxVolume ?? 100}
                w={140}
              />
              <Button
                size="xs"
                onClick={() => handleSave(idx)}
                loading={savingId === idx}
                disabled={savingId !== null}
              >
                Save fire
              </Button>
              {r.id && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => handleDeleteClick(r.id)}
                  aria-label={`delete fire ${idx + 1}`}
                  title="Delete fire"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
              {!r.id && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, i) => i !== idx))
                  }
                  aria-label={`delete fire ${idx + 1}`}
                  title="Remove (not yet saved)"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
          </Stack>
        </Paper>
      ))}
      <Group>
        <Button
          variant="default"
          leftSection={<IconPlus size={14} />}
          onClick={addRow}
        >
          Add fire
        </Button>
      </Group>
      <ConfirmModal
        opened={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, id: null })}
        onConfirm={handleConfirmDelete}
        title="Delete scheduled fire"
        message="This will permanently remove the scheduled fire."
        loading={deleting}
      />
    </Stack>
  );
}

export default ScheduledFiresSection;
