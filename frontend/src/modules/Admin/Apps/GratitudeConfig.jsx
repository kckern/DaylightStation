import React from 'react';
import { Stack, NumberInput, TextInput, Switch, Paper, Text, Divider, Group } from '@mantine/core';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import CrudTable from '../shared/CrudTable.jsx';

function updateNested(data, path, value) {
  const next = JSON.parse(JSON.stringify(data));
  const parts = path.split('.');
  let current = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return next;
}

const CATEGORY_COLUMNS = [
  { key: 'id', label: 'ID', type: 'text', placeholder: 'e.g. gratitude' },
  { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Gratitude' },
  { key: 'icon', label: 'Icon', type: 'text', placeholder: 'e.g. thanks.svg' },
];

const CATEGORY_DEFAULTS = { id: '', name: '', icon: '' };

function GratitudeConfigContent({ data, setData }) {
  const display = data.display || {};
  const snapshots = data.snapshots || {};

  return (
    <Stack gap="lg">
      {/* Categories */}
      <Paper p="md" withBorder>
        <Text fw={600} mb="sm">Categories</Text>
        <CrudTable
          items={data.categories || []}
          onChange={(updated) => setData({ ...data, categories: updated })}
          columns={CATEGORY_COLUMNS}
          createDefaults={CATEGORY_DEFAULTS}
          addLabel="Add Category"
          emptyMessage="No categories defined."
        />
      </Paper>

      <Divider />

      {/* Display Settings */}
      <Paper p="md" withBorder>
        <Text fw={600} mb="sm">Display Settings</Text>
        <Stack gap="sm">
          <NumberInput
            label="Options Per Page"
            value={display.options_per_page ?? ''}
            onChange={(val) => setData(updateNested(data, 'display.options_per_page', val))}
            min={1}
          />
          <NumberInput
            label="Animation Duration (ms)"
            value={display.animation_duration_ms ?? ''}
            onChange={(val) => setData(updateNested(data, 'display.animation_duration_ms', val))}
            min={0}
          />
          <NumberInput
            label="Highlight Duration (ms)"
            value={display.highlight_duration_ms ?? ''}
            onChange={(val) => setData(updateNested(data, 'display.highlight_duration_ms', val))}
            min={0}
          />
        </Stack>
      </Paper>

      <Divider />

      {/* Snapshots */}
      <Paper p="md" withBorder>
        <Text fw={600} mb="sm">Snapshots</Text>
        <Stack gap="sm">
          <Group>
            <Switch
              label="Enabled"
              checked={!!snapshots.enabled}
              onChange={(e) =>
                setData(updateNested(data, 'snapshots.enabled', e.currentTarget.checked))
              }
            />
          </Group>
          <NumberInput
            label="Retention Days"
            value={snapshots.retention_days ?? ''}
            onChange={(val) => setData(updateNested(data, 'snapshots.retention_days', val))}
            min={1}
          />
          <TextInput
            label="Directory"
            value={snapshots.directory ?? ''}
            readOnly
          />
        </Stack>
      </Paper>
    </Stack>
  );
}

function GratitudeConfig() {
  return (
    <ConfigFormWrapper
      filePath="household/config/gratitude.yml"
      title="Gratitude Configuration"
    >
      {({ data, setData }) => (
        <GratitudeConfigContent data={data} setData={setData} />
      )}
    </ConfigFormWrapper>
  );
}

export default GratitudeConfig;
