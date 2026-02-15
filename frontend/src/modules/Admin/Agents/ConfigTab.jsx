// frontend/src/modules/Admin/Agents/ConfigTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Button, NumberInput, TextInput, Select, Alert,
  Center, Loader, TagsInput,
} from '@mantine/core';
import { IconDeviceFloppy, IconAlertCircle } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

function ConfigTab({ agentId, userId }) {
  const [goals, setGoals] = useState(null);
  const [programState, setProgramState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState({ goals: false, program: false });

  // Load config data
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      DaylightAPI(`/api/v1/admin/config/files/users/${userId}/agents/${agentId}/goals`)
        .then(r => r.parsed)
        .catch(() => null),
      DaylightAPI(`/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`)
        .then(r => r.parsed)
        .catch(() => null),
    ]).then(([g, p]) => {
      setGoals(g || { weight: {}, nutrition: {} });
      setProgramState(p || { program: null });
      setDirty({ goals: false, program: false });
    }).catch(err => {
      setError(err);
    }).finally(() => {
      setLoading(false);
    });
  }, [agentId, userId]);

  const updateGoals = useCallback((path, value) => {
    setGoals(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = { ...(obj[parts[i]] || {}) };
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      return next;
    });
    setDirty(prev => ({ ...prev, goals: true }));
  }, []);

  const updateProgram = useCallback((path, value) => {
    setProgramState(prev => {
      const next = { ...prev };
      if (!next.program) next.program = {};
      next.program[path] = value;
      return next;
    });
    setDirty(prev => ({ ...prev, program: true }));
  }, []);

  const saveGoals = useCallback(async () => {
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/goals`,
        { parsed: goals },
        'PUT'
      );
      setDirty(prev => ({ ...prev, goals: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId, goals]);

  const saveProgramState = useCallback(async () => {
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`,
        { parsed: programState },
        'PUT'
      );
      setDirty(prev => ({ ...prev, program: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId, programState]);

  const clearProgram = useCallback(async () => {
    setProgramState({ program: null });
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`,
        { parsed: { program: null } },
        'PUT'
      );
      setDirty(prev => ({ ...prev, program: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId]);

  if (!userId) {
    return <Text c="dimmed" p="md">Select a user to configure</Text>;
  }

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
          {error.message || 'Failed to save'}
        </Alert>
      )}

      {/* User Goals */}
      <Paper p="md">
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
            User Goals
          </Text>
          <Button
            size="xs"
            leftSection={<IconDeviceFloppy size={14} />}
            disabled={!dirty.goals}
            loading={saving}
            onClick={saveGoals}
          >
            Save Goals
          </Button>
        </Group>

        <Stack gap="sm">
          <NumberInput
            label="Weight target (lbs)"
            value={goals?.weight?.target_lbs || ''}
            onChange={(v) => updateGoals('weight.target_lbs', v)}
            min={50}
            max={500}
          />
          <NumberInput
            label="Daily calorie target"
            value={goals?.nutrition?.daily_calories || ''}
            onChange={(v) => updateGoals('nutrition.daily_calories', v)}
            min={500}
            max={10000}
            step={50}
          />
          <NumberInput
            label="Daily protein target (g)"
            value={goals?.nutrition?.daily_protein || ''}
            onChange={(v) => updateGoals('nutrition.daily_protein', v)}
            min={0}
            max={500}
          />
          <NumberInput
            label="Daily carbs target (g)"
            value={goals?.nutrition?.daily_carbs || ''}
            onChange={(v) => updateGoals('nutrition.daily_carbs', v)}
            min={0}
            max={1000}
          />
          <NumberInput
            label="Daily fat target (g)"
            value={goals?.nutrition?.daily_fat || ''}
            onChange={(v) => updateGoals('nutrition.daily_fat', v)}
            min={0}
            max={500}
          />
        </Stack>
      </Paper>

      {/* Program State */}
      <Paper p="md">
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
            Program State
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="light" color="red" onClick={clearProgram}>
              Clear Program
            </Button>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              disabled={!dirty.program}
              loading={saving}
              onClick={saveProgramState}
            >
              Save
            </Button>
          </Group>
        </Group>

        {!programState?.program ? (
          <Text c="dimmed" size="sm">No active program (ad-hoc mode)</Text>
        ) : (
          <Stack gap="sm">
            <TextInput
              label="Program ID"
              value={programState.program.id || ''}
              onChange={(e) => updateProgram('id', e.target.value)}
              placeholder="e.g., p90x"
            />
            <TextInput
              label="Content source"
              value={programState.program.content_source || ''}
              onChange={(e) => updateProgram('content_source', e.target.value)}
              placeholder="e.g., plex:12345"
            />
            <Group grow>
              <NumberInput
                label="Current day"
                value={programState.program.current_day || ''}
                onChange={(v) => updateProgram('current_day', v)}
                min={1}
              />
              <NumberInput
                label="Total days"
                value={programState.program.total_days || ''}
                onChange={(v) => updateProgram('total_days', v)}
                min={1}
              />
            </Group>
            <Select
              label="Status"
              value={programState.program.status || 'active'}
              onChange={(v) => updateProgram('status', v)}
              data={[
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
                { value: 'completed', label: 'Completed' },
                { value: 'abandoned', label: 'Abandoned' },
              ]}
            />
            <TextInput
              label="Started"
              value={programState.program.started || ''}
              onChange={(e) => updateProgram('started', e.target.value)}
              placeholder="YYYY-MM-DD"
            />
            <TagsInput
              label="Rest days"
              value={programState.program.rest_days || []}
              onChange={(v) => updateProgram('rest_days', v)}
              placeholder="e.g., sunday"
            />
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

export default ConfigTab;
