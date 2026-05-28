import React, { useState, useEffect, useRef } from 'react';
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
import {
  IconTrash,
  IconPlus,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';
import { ScheduleWindowSummary } from './ScheduleWindowSummary.jsx';

/**
 * Generate a stable client-side key for a row. Used for identity across
 * reorders and for dirty-tracking via baselineByKey ref. Mirrors the
 * newFireId() pattern in ScheduledFiresSection.jsx.
 */
function newKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * SchedulesSection — continuous time-window schedule CRUD for private devices.
 *
 * Each window is { start: 'HH:MM', end: 'HH:MM', queue: 'source:id', shuffle?: boolean }.
 *
 * Each row carries a client-side `_key` for stable identity (collapse/expand
 * state, dirty-tracking). `_key` is stripped before sending to mutations.
 *
 * Collapse-row behavior:
 *   - Existing rows (from slot.schedules) start collapsed → ScheduleWindowSummary.
 *   - Newly-added rows start expanded.
 *   - Rows whose form differs from baseline stay expanded even after a
 *     manual collapse attempt (dirty wins).
 *
 * The wire field on the device is `schedules` (matches the hub's canonical
 * YAML and HubDevice.toYaml() output).
 *
 * Props:
 *   slot:      device config { color, schedules?: [...], ... }
 *   mutations: object from useHubMutations
 */
export function SchedulesSection({ slot, mutations }) {
  const baselineByKey = useRef(new Map());

  // Lazy initializer: hydrate rows + baseline in one pass so first render
  // sees existing rows as collapsed (not falsely-dirty for lack of baseline).
  const [rows, setRows] = useState(() => {
    const next = (slot?.schedules ?? []).map((w) => ({ _key: newKey(), ...w }));
    baselineByKey.current = new Map(
      next.map((w) => [
        w._key,
        {
          start: w.start || '',
          end: w.end || '',
          queue: w.queue || '',
          shuffle: !!w.shuffle,
        },
      ])
    );
    return next;
  });
  const [saving, setSaving] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const initialSchedulesRef = useRef(slot?.schedules);

  // Re-sync when slot prop changes (e.g. after revalidate / successful save).
  // Skip the first run since the lazy initializer already handled it.
  useEffect(() => {
    if (initialSchedulesRef.current === slot?.schedules) {
      initialSchedulesRef.current = null; // mark first run as consumed
      return;
    }
    const next = (slot?.schedules ?? []).map((w) => ({ _key: newKey(), ...w }));
    baselineByKey.current = new Map(
      next.map((w) => [
        w._key,
        {
          start: w.start || '',
          end: w.end || '',
          queue: w.queue || '',
          shuffle: !!w.shuffle,
        },
      ])
    );
    setRows(next);
    setExpandedKeys(new Set());
  }, [slot?.schedules]);

  const updateWindow = (idx, patch) => {
    setRows((prev) => prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  };

  const removeWindow = (idx) => {
    setRows((prev) => {
      const target = prev[idx];
      if (target) {
        setExpandedKeys((set) => {
          if (!set.has(target._key)) return set;
          const copy = new Set(set);
          copy.delete(target._key);
          return copy;
        });
        baselineByKey.current.delete(target._key);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const addWindow = () => {
    const fresh = { _key: newKey(), start: '', end: '', queue: '', shuffle: false };
    setRows((prev) => [...prev, fresh]);
    setExpandedKeys((set) => {
      const copy = new Set(set);
      copy.add(fresh._key);
      return copy;
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
    const b = baselineByKey.current.get(row._key);
    if (!b) return true; // new row, no baseline → treat as dirty so it stays open
    return (
      b.start !== (row.start || '') ||
      b.end !== (row.end || '') ||
      b.queue !== (row.queue || '') ||
      b.shuffle !== !!row.shuffle
    );
  };

  const isExpanded = (row) => expandedKeys.has(row._key) || isRowDirty(row);

  const handleSave = async () => {
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, {
        schedules: rows.map((r) => {
          // Strip _key before sending to wire.
          const { _key, ...wire } = r;
          return {
            start: wire.start || '',
            end: wire.end || '',
            queue: wire.queue || '',
            shuffle: !!wire.shuffle,
          };
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      {rows.length === 0 && (
        <Text size="sm" c="dimmed">No continuous windows configured.</Text>
      )}
      {rows.map((row, idx) => (
        <Paper key={row._key} withBorder p="sm">
          {isExpanded(row) ? (
            <Group gap="sm" align="flex-end" wrap="wrap">
              <TextInput
                label="Start"
                value={row.start || ''}
                onChange={(e) => updateWindow(idx, { start: e.currentTarget.value })}
                placeholder="HH:MM"
                w={100}
              />
              <TextInput
                label="End"
                value={row.end || ''}
                onChange={(e) => updateWindow(idx, { end: e.currentTarget.value })}
                placeholder="HH:MM"
                w={100}
              />
              <div style={{ flex: 1, minWidth: 180 }}>
                <Text size="xs" mb={4}>Queue</Text>
                <LabeledContentPicker
                  value={row.queue || ''}
                  onChange={(id) => updateWindow(idx, { queue: id || '' })}
                  placeholder="Pick a queue..."
                />
              </div>
              <Switch
                label="Shuffle"
                checked={!!row.shuffle}
                onChange={(e) => updateWindow(idx, { shuffle: e.currentTarget.checked })}
              />
              <ActionIcon
                variant="subtle"
                onClick={() => toggleExpand(row._key)}
                aria-label={`collapse window ${idx + 1}`}
                title="Collapse window"
              >
                <IconChevronUp size={16} />
              </ActionIcon>
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
          ) : (
            <Group justify="space-between" wrap="nowrap">
              <Group
                onClick={() => toggleExpand(row._key)}
                style={{ cursor: 'pointer', flex: 1 }}
                wrap="nowrap"
              >
                <ScheduleWindowSummary window={row} />
              </Group>
              <Group gap={4} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  onClick={() => toggleExpand(row._key)}
                  aria-label={`expand window ${idx + 1}`}
                  title="Expand window"
                >
                  <IconChevronDown size={16} />
                </ActionIcon>
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
            </Group>
          )}
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
