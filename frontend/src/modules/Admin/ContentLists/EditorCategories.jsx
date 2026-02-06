import React, { useState } from 'react';
import {
  Accordion,
  Switch,
  Slider,
  NumberInput,
  Select,
  TextInput,
  Chip,
  Group,
  Stack,
  Text,
  ActionIcon,
  Button,
  Box,
  Image,
  UnstyledButton
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import {
  IconUser,
  IconPlayerPlay,
  IconCalendar,
  IconEye,
  IconChartBar,
  IconSettings,
  IconPlus,
  IconTrash,
  IconPhoto
} from '@tabler/icons-react';
import { ACTION_OPTIONS, DAYS_PRESETS, ITEM_DEFAULTS } from './listConstants.js';
import ImagePickerModal from './ImagePickerModal.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';

// Shader options available in the system
const SHADER_OPTIONS = [
  { value: null, label: 'Default' },
  { value: 'regular', label: 'Regular' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'night', label: 'Night' },
  { value: 'dark', label: 'Dark' },
  { value: 'screensaver', label: 'Screensaver' },
  { value: 'video', label: 'Video' },
  { value: 'text', label: 'Text' }
];

/**
 * Category panel for Identity fields
 */
function IdentityCategory({ item, onChange, existingGroups = [] }) {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const groupOptions = existingGroups
    .filter(g => g)
    .map(g => ({ value: g, label: g }));

  const imageSrc = item.image
    ? (item.image.startsWith('/media/') || item.image.startsWith('media/')
        ? DaylightMediaPath(item.image)
        : item.image)
    : null;

  return (
    <Stack gap="sm">
      <TextInput
        label="Label"
        placeholder="Display name for the item"
        value={item.label || ''}
        onChange={(e) => onChange('label', e.target.value)}
      />
      <TextInput
        label="Input"
        placeholder="plex:123 or media:path/to/file"
        description="Format: source:id"
        value={item.input || ''}
        onChange={(e) => onChange('input', e.target.value)}
      />
      <Select
        label="Action"
        data={ACTION_OPTIONS}
        value={item.action || ITEM_DEFAULTS.action}
        onChange={(value) => onChange('action', value)}
      />
      <Switch
        label="Active"
        description="Inactive items are hidden from lists"
        checked={item.active !== false}
        onChange={(e) => onChange('active', e.target.checked)}
      />
      <Select
        label="Group"
        description="Optional grouping for organization"
        placeholder="Select or type a group"
        data={groupOptions}
        value={item.group || ''}
        onChange={(value) => onChange('group', value || null)}
        searchable
        creatable
        getCreateLabel={(query) => `+ Create "${query}"`}
        onCreate={(query) => {
          return query;
        }}
        clearable
      />
      <Box>
        <Text size="sm" fw={500} mb={4}>Image</Text>
        <Group align="center" gap="sm">
          <UnstyledButton onClick={() => setImagePickerOpen(true)}>
            {imageSrc ? (
              <Image src={imageSrc} height={60} width={60} fit="cover" radius="sm" />
            ) : (
              <Box style={{
                width: 60, height: 60,
                border: '2px dashed var(--mantine-color-dark-4)',
                borderRadius: 'var(--mantine-radius-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <IconPhoto size={20} color="var(--mantine-color-dimmed)" />
              </Box>
            )}
          </UnstyledButton>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPhoto size={14} />}
            onClick={() => setImagePickerOpen(true)}
          >
            {item.image ? 'Change Image' : 'Set Image'}
          </Button>
        </Group>
        <ImagePickerModal
          opened={imagePickerOpen}
          onClose={() => setImagePickerOpen(false)}
          currentImage={item.image || null}
          inheritedImage={null}
          onSave={(path) => onChange('image', path)}
        />
      </Box>
    </Stack>
  );
}

/**
 * Category panel for Playback fields
 */
function PlaybackCategory({ item, onChange }) {
  return (
    <Stack gap="sm">
      <Group grow>
        <Switch
          label="Shuffle"
          description="Randomize playback order"
          checked={item.shuffle === true}
          onChange={(e) => onChange('shuffle', e.target.checked || null)}
        />
        <Switch
          label="Continuous"
          description="Auto-play next item"
          checked={item.continuous === true}
          onChange={(e) => onChange('continuous', e.target.checked || null)}
        />
      </Group>
      <Group grow>
        <Switch
          label="Loop"
          description="Repeat current item"
          checked={item.loop === true}
          onChange={(e) => onChange('loop', e.target.checked || null)}
        />
        <Switch
          label="Fixed Order"
          description="Maintain original order"
          checked={item.fixedOrder === true}
          onChange={(e) => onChange('fixedOrder', e.target.checked || null)}
        />
      </Group>
      <Box>
        <Text size="sm" fw={500} mb={4}>Volume</Text>
        <Group>
          <Slider
            style={{ flex: 1 }}
            min={0}
            max={100}
            value={item.volume ?? ITEM_DEFAULTS.volume}
            onChange={(value) => onChange('volume', value === 100 ? null : value)}
            marks={[
              { value: 0, label: '0%' },
              { value: 50, label: '50%' },
              { value: 100, label: '100%' }
            ]}
          />
          <NumberInput
            w={80}
            min={0}
            max={100}
            value={item.volume ?? ITEM_DEFAULTS.volume}
            onChange={(value) => onChange('volume', value === 100 ? null : value)}
            suffix="%"
          />
        </Group>
      </Box>
      <Box>
        <Text size="sm" fw={500} mb={4}>Playback Rate</Text>
        <Group>
          <Slider
            style={{ flex: 1 }}
            min={0.5}
            max={3.0}
            step={0.1}
            value={item.playbackRate ?? ITEM_DEFAULTS.playbackRate}
            onChange={(value) => onChange('playbackRate', value === 1.0 ? null : value)}
            marks={[
              { value: 0.5, label: '0.5x' },
              { value: 1.0, label: '1x' },
              { value: 2.0, label: '2x' },
              { value: 3.0, label: '3x' }
            ]}
          />
          <NumberInput
            w={80}
            min={0.5}
            max={3.0}
            step={0.1}
            decimalScale={1}
            value={item.playbackRate ?? ITEM_DEFAULTS.playbackRate}
            onChange={(value) => onChange('playbackRate', value === 1.0 ? null : value)}
            suffix="x"
          />
        </Group>
      </Box>
    </Stack>
  );
}

/**
 * Category panel for Scheduling fields
 */
function SchedulingCategory({ item, onChange }) {
  return (
    <Stack gap="sm">
      <Box>
        <Text size="sm" fw={500} mb={8}>Days</Text>
        <Chip.Group
          value={item.days || null}
          onChange={(value) => onChange('days', value || null)}
        >
          <Group gap="xs">
            {DAYS_PRESETS.map((preset) => (
              <Chip
                key={preset.value || 'any'}
                value={preset.value}
                variant="outline"
              >
                {preset.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Box>
      <TextInput
        label="Snooze"
        placeholder="e.g., 7d, 2w, 1m"
        description="Temporarily hide this item for a duration"
        value={item.snooze || ''}
        onChange={(e) => onChange('snooze', e.target.value || null)}
      />
      <DatePickerInput
        label="Wait Until"
        placeholder="Select a date"
        description="Don't show this item until the specified date"
        value={item.waitUntil ? new Date(item.waitUntil) : null}
        onChange={(date) => onChange('waitUntil', date ? date.toISOString() : null)}
        clearable
      />
    </Stack>
  );
}

/**
 * Category panel for Display fields
 */
function DisplayCategory({ item, onChange }) {
  return (
    <Stack gap="sm">
      <Select
        label="Shader"
        description="Visual style for playback"
        data={SHADER_OPTIONS}
        value={item.shader || null}
        onChange={(value) => onChange('shader', value || null)}
        clearable
      />
      <Switch
        label="Composite"
        description="Layer multiple media sources"
        checked={item.composite === true}
        onChange={(e) => onChange('composite', e.target.checked || null)}
      />
      <Switch
        label="Playable"
        description="Can this item be played"
        checked={item.playable !== false}
        onChange={(e) => onChange('playable', e.target.checked ? null : false)}
      />
    </Stack>
  );
}

/**
 * Category panel for Progress fields (typically read-only)
 */
function ProgressCategory({ item, onChange, allowOverride = false }) {
  const [overrideEnabled, setOverrideEnabled] = React.useState(false);

  return (
    <Stack gap="sm">
      <Box>
        <Text size="sm" fw={500} mb={4}>Progress</Text>
        <Group>
          <Slider
            style={{ flex: 1 }}
            min={0}
            max={100}
            value={item.progress ?? 0}
            onChange={(value) => overrideEnabled && onChange('progress', value || null)}
            disabled={!overrideEnabled}
          />
          <NumberInput
            w={80}
            min={0}
            max={100}
            value={item.progress ?? 0}
            onChange={(value) => overrideEnabled && onChange('progress', value || null)}
            disabled={!overrideEnabled}
            suffix="%"
          />
        </Group>
      </Box>
      <Switch
        label="Watched"
        description="Mark as fully watched/completed"
        checked={item.watched === true}
        onChange={(e) => overrideEnabled && onChange('watched', e.target.checked || null)}
        disabled={!overrideEnabled}
      />
      {allowOverride && (
        <Switch
          label="Enable Override"
          description="Allow manual editing of progress values"
          checked={overrideEnabled}
          onChange={(e) => setOverrideEnabled(e.target.checked)}
          color="orange"
        />
      )}
    </Stack>
  );
}

/**
 * Category panel for Custom (unknown) fields
 */
function CustomCategory({ customFields, onCustomFieldChange }) {
  const [newKey, setNewKey] = React.useState('');
  const [newValue, setNewValue] = React.useState('');

  const entries = Object.entries(customFields || {});

  const handleAdd = () => {
    if (newKey.trim()) {
      onCustomFieldChange(newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
    }
  };

  const handleDelete = (key) => {
    onCustomFieldChange(key, undefined);
  };

  return (
    <Stack gap="sm">
      {entries.length === 0 && (
        <Text size="sm" c="dimmed">No custom fields defined</Text>
      )}
      {entries.map(([key, value]) => (
        <Group key={key} align="flex-end">
          <TextInput
            label="Key"
            value={key}
            readOnly
            style={{ flex: 1 }}
          />
          <TextInput
            label="Value"
            value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
            onChange={(e) => onCustomFieldChange(key, e.target.value)}
            style={{ flex: 2 }}
          />
          <ActionIcon
            color="red"
            variant="subtle"
            onClick={() => handleDelete(key)}
            mb={4}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group align="flex-end">
        <TextInput
          label="New Key"
          placeholder="field_name"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          style={{ flex: 1 }}
        />
        <TextInput
          label="New Value"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          style={{ flex: 2 }}
        />
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={handleAdd}
          disabled={!newKey.trim()}
        >
          Add
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * EditorCategories - Accordion panels for Full mode item editor
 *
 * @param {Object} item - Current item data
 * @param {Function} onChange - Callback for field changes: (field, value) => void
 * @param {Object} customFields - Object of unknown/custom fields
 * @param {Function} onCustomFieldChange - Callback for custom field changes
 * @param {boolean} isWatchlist - Whether to show progress section
 * @param {string[]} existingGroups - List of existing group names for autocomplete
 */
function EditorCategories({
  item,
  onChange,
  customFields = {},
  onCustomFieldChange,
  isWatchlist = false,
  existingGroups = []
}) {
  return (
    <Accordion defaultValue="identity" variant="separated">
      <Accordion.Item value="identity">
        <Accordion.Control icon={<IconUser size={18} />}>
          Identity
        </Accordion.Control>
        <Accordion.Panel>
          <IdentityCategory
            item={item}
            onChange={onChange}
            existingGroups={existingGroups}
          />
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="playback">
        <Accordion.Control icon={<IconPlayerPlay size={18} />}>
          Playback
        </Accordion.Control>
        <Accordion.Panel>
          <PlaybackCategory item={item} onChange={onChange} />
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="scheduling">
        <Accordion.Control icon={<IconCalendar size={18} />}>
          Scheduling
        </Accordion.Control>
        <Accordion.Panel>
          <SchedulingCategory item={item} onChange={onChange} />
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="display">
        <Accordion.Control icon={<IconEye size={18} />}>
          Display
        </Accordion.Control>
        <Accordion.Panel>
          <DisplayCategory item={item} onChange={onChange} />
        </Accordion.Panel>
      </Accordion.Item>

      {isWatchlist && (
        <Accordion.Item value="progress">
          <Accordion.Control icon={<IconChartBar size={18} />}>
            Progress
          </Accordion.Control>
          <Accordion.Panel>
            <ProgressCategory
              item={item}
              onChange={onChange}
              allowOverride={true}
            />
          </Accordion.Panel>
        </Accordion.Item>
      )}

      <Accordion.Item value="custom">
        <Accordion.Control icon={<IconSettings size={18} />}>
          Custom Fields
        </Accordion.Control>
        <Accordion.Panel>
          <CustomCategory
            customFields={customFields}
            onCustomFieldChange={onCustomFieldChange}
          />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export default EditorCategories;

// Also export individual categories for potential standalone use
export {
  IdentityCategory,
  PlaybackCategory,
  SchedulingCategory,
  DisplayCategory,
  ProgressCategory,
  CustomCategory,
  SHADER_OPTIONS
};
