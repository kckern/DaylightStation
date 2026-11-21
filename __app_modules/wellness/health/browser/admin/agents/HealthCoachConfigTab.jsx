// Health Coach Admin goals and program configuration.

import React, { useRef, useState } from 'react';
import {
  Stack, Paper, Text, Group, Button, NumberInput, TextInput, Select, Alert,
  Center, Loader, TagsInput,
} from '@mantine/core';
import { IconDeviceFloppy, IconAlertCircle } from '@tabler/icons-react';
import { useApiResource } from "../../../../../../frontend/src/lib/hooks/useApiResource.js";
import { ErrorState } from '../../../../../../frontend/src/lib/ui/states.jsx';
import { DaylightAPI } from "../../../../../../frontend/src/lib/api.mjs";

const DEFAULT_GOALS = { weight: {}, nutrition: {} };
const DEFAULT_PROGRAM = { program: null };

function HealthCoachConfigTab({ userId }) {
  if (!userId) return <Text c="dimmed" p="md">Select a user to configure</Text>;
  const base = `/api/v1/admin/health-coach/members/${encodeURIComponent(userId)}/config`;
  return (
    <Stack key={base} gap="md">
      <ConfigDocument path={`${base}/goals`} label="User goals" fallback={DEFAULT_GOALS} Form={GoalsForm} />
      <ConfigDocument path={`${base}/program-state`} label="Program state" fallback={DEFAULT_PROGRAM} Form={ProgramForm} />
    </Stack>
  );
}

function ConfigDocument({ path, label, fallback, Form }) {
  const { data, loading, error, reload } = useApiResource(path);
  if (loading && !data) return <Center h={200}><Loader aria-label={label} /></Center>;
  const missing = error?.status === 404 && error?.body?.code === 'NOT_FOUND';
  if (error && !missing) return <ErrorState error={error} label={label} onRetry={reload} />;
  const parsed = missing ? fallback : data?.parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <ErrorState error={new Error('The file does not contain a configuration object.')} label={label} onRetry={reload} />;
  }
  return <DocumentDraft path={path} initial={parsed} Form={Form} />;
}

function DocumentDraft({ path, initial, Form }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  async function save(next = draft) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await DaylightAPI(path, { parsed: next }, 'PUT');
      setSaved(next);
      // A clear proposes a different document. Only replace the live draft
      // if the operator has made no further edits since sending it.
      setDraft(current => current === draft ? next : current);
    } catch (err) {
      setError(err);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
      {error.message || 'Failed to save'}
    </Alert>}
    <Form draft={draft} setDraft={setDraft} dirty={draft !== saved} saving={saving} save={save} />
  </>;
}

function GoalsForm({ draft: goals, setDraft, dirty, saving, save }) {
  function updateGoals(path, value) {
    const [group, key] = path.split('.');
    setDraft(previous => ({ ...previous, [group]: { ...previous[group], [key]: value } }));
  }
  return (
    <Paper p="md">
      <Group justify="space-between" mb="md">
        <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
          User Goals
        </Text>
        <Button
          size="xs"
          leftSection={<IconDeviceFloppy size={14} />}
          disabled={!dirty || saving}
          loading={saving}
          onClick={() => save()}
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
          value={goals?.nutrition?.daily_protein ?? ''}
          onChange={(v) => updateGoals('nutrition.daily_protein', v)}
          min={0}
          max={500}
        />
        <NumberInput
          label="Daily carbs target (g)"
          value={goals?.nutrition?.daily_carbs ?? ''}
          onChange={(v) => updateGoals('nutrition.daily_carbs', v)}
          min={0}
          max={1000}
        />
        <NumberInput
          label="Daily fat target (g)"
          value={goals?.nutrition?.daily_fat ?? ''}
          onChange={(v) => updateGoals('nutrition.daily_fat', v)}
          min={0}
          max={500}
        />
      </Stack>
    </Paper>
  );
}

function ProgramForm({ draft: programState, setDraft, dirty, saving, save }) {
  function updateProgram(key, value) {
    setDraft(previous => ({ ...previous, program: { ...previous.program, [key]: value } }));
  }
  return (
    <Paper p="md">
      <Group justify="space-between" mb="md">
        <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
          Program State
        </Text>
        <Group gap="xs">
          <Button size="xs" variant="light" color="red" disabled={saving} onClick={() => save({ ...programState, program: null })}>
            Clear Program
          </Button>
          <Button
            size="xs"
            leftSection={<IconDeviceFloppy size={14} />}
            disabled={!dirty || saving}
            loading={saving}
            onClick={() => save()}
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
  );
}

export default HealthCoachConfigTab;
