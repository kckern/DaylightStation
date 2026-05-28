import React, { useState, useEffect, useRef } from 'react';
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
import {
  IconTrash,
  IconPlus,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';
import ConfirmModal from '../../shared/ConfirmModal.jsx';
import { ScheduledFireSummary } from './ScheduledFireSummary.jsx';

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
 * Build a baseline snapshot of comparable fields for dirty-tracking. The
 * baseline must mirror the post-fromWire camelCase shape so isRowDirty()
 * compares apples-to-apples.
 */
function baselineFromRow(row) {
  return {
    time: row.time || '',
    days: row.days || 'weekdays',
    queue: row.queue || '',
    indefinite: !!row.indefinite,
    durationMin: row.durationMin ?? null,
    volumeOverride: row.volumeOverride ?? null,
  };
}

/**
 * Resolve the stable React/Set key for a row. Saved fires use their server
 * id; unsaved rows get a client-only `_key` so they retain identity through
 * expand/collapse and dirty-tracking.
 */
function keyOf(row) {
  return row.id || row._key;
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
 * SaveScheduledFire use case input shape. The `_key` field is CLIENT-ONLY and
 * is never sent to the wire (handleSave builds the payload explicitly).
 *
 * Collapse-row behavior (mirrors SchedulesSection):
 *   - Existing rows (with server id) start collapsed → ScheduledFireSummary.
 *   - Newly-added rows start expanded.
 *   - Rows whose form differs from baseline stay expanded even after a
 *     manual collapse attempt (dirty wins).
 *
 * Props:
 *   target:        device color
 *   fires:         array of fire objects filtered to this target (wire shape)
 *   slotMaxVolume: clamp for volume override NumberInput
 *   mutations:     object from useHubMutations
 */
export function ScheduledFiresSection({ target, fires, slotMaxVolume, mutations }) {
  const baselineByKey = useRef(new Map());
  const tmpCounter = useRef(0);

  // Lazy initializer: hydrate rows + baseline in one pass so first render
  // sees existing rows as collapsed (not falsely-dirty for lack of baseline).
  const [rows, setRows] = useState(() => {
    const next = (fires ?? []).map(fromWire);
    baselineByKey.current = new Map(
      next.map((r) => [keyOf(r), baselineFromRow(r)])
    );
    return next;
  });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null });
  const [savingId, setSavingId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const initialFiresRef = useRef(fires);

  // Re-sync local state when fires prop changes (e.g. after revalidate).
  // Skip the first run since the lazy initializer already handled it.
  useEffect(() => {
    if (initialFiresRef.current === fires) {
      initialFiresRef.current = null; // mark first run as consumed
      return;
    }
    const next = (fires ?? []).map(fromWire);
    baselineByKey.current = new Map(
      next.map((r) => [keyOf(r), baselineFromRow(r)])
    );
    setRows(next);
    setExpandedKeys(new Set());
  }, [fires]);

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const fresh = {
      id: null, // assigned at save
      _key: `tmp-${tmpCounter.current++}`,
      time: '',
      days: 'weekdays',
      target,
      queue: '',
      indefinite: false,
      durationMin: 30,
      volumeOverride: null,
    };
    setRows((prev) => [...prev, fresh]);
    setExpandedKeys((set) => {
      const copy = new Set(set);
      copy.add(keyOf(fresh));
      return copy;
    });
  };

  const handleSave = async (idx) => {
    const row = rows[idx];
    const id = row.id || newFireId();
    setSavingId(idx);
    try {
      const out = await mutations.saveFire({
        id,
        time: row.time,
        days: row.days,
        target: row.target || target,
        queue: row.queue,
        durationMin: row.indefinite ? null : Number(row.durationMin) || null,
        volumeOverride: row.volumeOverride == null ? null : Number(row.volumeOverride),
      });
      if (out?.ok) {
        updateRow(idx, { id });
      }
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
      const out = await mutations.deleteFire(confirmDelete.id);
      if (out?.ok) {
        setConfirmDelete({ open: false, id: null });
      }
    } finally {
      setDeleting(false);
    }
  };

  const removeUnsavedRow = (idx) => {
    setRows((prev) => {
      const targetRow = prev[idx];
      if (targetRow) {
        const k = keyOf(targetRow);
        setExpandedKeys((set) => {
          if (!set.has(k)) return set;
          const copy = new Set(set);
          copy.delete(k);
          return copy;
        });
        baselineByKey.current.delete(k);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const toggleExpand = (key) => {
    setExpandedKeys((set) => {
      const copy = new Set(set);
      if (copy.has(key)) copy.delete(key);
      else copy.add(key);
      return copy;
    });
  };

  const isRowDirty = (row) => {
    const k = keyOf(row);
    const b = baselineByKey.current.get(k);
    if (!b) return true; // new row, no baseline → treat as dirty so it stays open
    const cur = baselineFromRow(row);
    return (
      b.time !== cur.time ||
      b.days !== cur.days ||
      b.queue !== cur.queue ||
      b.indefinite !== cur.indefinite ||
      b.durationMin !== cur.durationMin ||
      b.volumeOverride !== cur.volumeOverride
    );
  };

  const isExpanded = (row) => expandedKeys.has(keyOf(row)) || isRowDirty(row);

  const renderTrashIcon = (r, idx) => (
    r.id ? (
      <ActionIcon
        color="red"
        variant="subtle"
        onClick={() => handleDeleteClick(r.id)}
        aria-label={`delete fire ${idx + 1}`}
        title="Delete fire"
      >
        <IconTrash size={16} />
      </ActionIcon>
    ) : (
      <ActionIcon
        color="red"
        variant="subtle"
        onClick={() => removeUnsavedRow(idx)}
        aria-label={`delete fire ${idx + 1}`}
        title="Remove (not yet saved)"
      >
        <IconTrash size={16} />
      </ActionIcon>
    )
  );

  return (
    <Stack gap="sm">
      {rows.length === 0 && (
        <Text size="sm" c="dimmed">No scheduled fires for this device.</Text>
      )}
      {rows.map((r, idx) => {
        const k = keyOf(r);
        return (
          <Paper key={k} withBorder p="sm">
            {isExpanded(r) ? (
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
                  <ActionIcon
                    variant="subtle"
                    onClick={() => toggleExpand(k)}
                    aria-label={`collapse fire ${idx + 1}`}
                    title="Collapse fire"
                  >
                    <IconChevronUp size={16} />
                  </ActionIcon>
                  {renderTrashIcon(r, idx)}
                </Group>
              </Stack>
            ) : (
              <Group justify="space-between" wrap="nowrap">
                <Group
                  onClick={() => toggleExpand(k)}
                  style={{ cursor: 'pointer', flex: 1 }}
                  wrap="nowrap"
                >
                  <ScheduledFireSummary row={r} />
                </Group>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => toggleExpand(k)}
                    aria-label={`expand fire ${idx + 1}`}
                    title="Expand fire"
                  >
                    <IconChevronDown size={16} />
                  </ActionIcon>
                  {renderTrashIcon(r, idx)}
                </Group>
              </Group>
            )}
          </Paper>
        );
      })}
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
