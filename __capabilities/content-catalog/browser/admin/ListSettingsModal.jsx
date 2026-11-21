import React from 'react';
import { FormDialog } from '../../../../frontend/src/lib/ui/FormDialog.jsx';
import { SettingsDialogForm } from './SettingsDialogForm.jsx';
import {
  Autocomplete,
  TextInput,
  Textarea,
  Select,
  Chip,
  Switch,
  Slider,
  Group,
  NumberInput,
  Box,
  Text
} from '@mantine/core';
import {
  ACTION_OPTIONS,
  SORTING_OPTIONS,
  DAYS_PRESETS,
  LIST_DEFAULTS
} from "./listConstants.js";

/**
 * ListSettingsModal - Modal for editing list-level settings
 *
 * @param {boolean} opened - Whether the modal is open
 * @param {Function} onClose - Callback to close modal
 * @param {Object} metadata - Current list metadata object
 * @param {Function} onSave - Submit settings through the folder's command owner
 * @param {boolean} loading - Boolean for save loading state
 * @param {Object} read - The folder's current read state and Retry action
 * @param {string[]} existingGroups - List of existing group names for autocomplete
 */
function ListSettingsModal({
  opened,
  onClose,
  metadata,
  onSave,
  loading,
  read,
  existingGroups = []
}) {
  const settings = { ...metadata, ...metadata?.metadata };
  const confirmed = {
    title: metadata?.title || '',
    description: metadata?.description || '',
    group: settings.group || '',
    icon: settings.icon || '',
    sorting: settings.sorting || LIST_DEFAULTS.sorting,
    days: settings.days || null,
    active: settings.active !== false,
    defaultAction: settings.defaultAction || LIST_DEFAULTS.defaultAction,
    defaultVolume: settings.defaultVolume ?? null,
    defaultPlaybackRate: settings.defaultPlaybackRate ?? null,
  };

  return (
    <FormDialog
      opened={opened}
      onClose={onClose}
      title="List Settings"
      centered
      size="lg"
    >
      {opened && (
        <SettingsDialogForm source={metadata} confirmed={confirmed} defaults={LIST_DEFAULTS}
          loading={loading} read={read} recoveryLabel="List settings recovery" onClose={onClose}
          onSave={onSave} saveLabel="Save Settings" saveTestId="save-list-settings-button">
          {(formData, handleInputChange) => (
            <ListSettingsFields formData={formData} handleInputChange={handleInputChange} existingGroups={existingGroups} />
          )}
        </SettingsDialogForm>
      )}
    </FormDialog>
  );
}

function ListSettingsFields({ formData, handleInputChange, existingGroups }) {
  return (
    <>
      {/* Basic Info */}
      <TextInput
        label="Title"
        placeholder="Optional display title for the list"
        value={formData.title || ''}
        onChange={(e) => handleInputChange('title', e.target.value)}
        data-testid="list-title-input"
      />

      <Textarea
        label="Description"
        placeholder="Optional description for the list"
        value={formData.description || ''}
        onChange={(e) => handleInputChange('description', e.target.value)}
        minRows={2}
        autosize
        maxRows={4}
      />

      <Group grow>
        <Autocomplete
          label="Group"
          description="Category for organizing lists"
          placeholder="Select or type a group"
          data={[...new Set(existingGroups.filter(Boolean))]}
          value={formData.group || ''}
          onChange={(value) => handleInputChange('group', value)}
          clearable
        />

        <TextInput
          label="Icon"
          placeholder="e.g., IconMusic, IconVideo"
          description="Icon name from Tabler icons"
          value={formData.icon || ''}
          onChange={(e) => handleInputChange('icon', e.target.value)}
        />
      </Group>

      {/* Sorting and Scheduling */}
      <Select
        label="Sorting"
        description="How items are ordered in the list"
        data={SORTING_OPTIONS}
        value={formData.sorting || LIST_DEFAULTS.sorting}
        onChange={(value) => handleInputChange('sorting', value)}
      />

      <Box>
        <Text size="sm" fw={500} mb={8}>Days</Text>
        <Chip.Group
          value={formData.days || null}
          onChange={(value) => handleInputChange('days', value || null)}
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

      <Switch
        label="Active"
        description="Inactive lists are hidden from the main view"
        checked={formData.active !== false}
        onChange={(e) => handleInputChange('active', e.target.checked)}
      />

      {/* Default Playback Settings */}
      <Text size="sm" fw={500} mt="sm">Default Playback Settings</Text>
      <Text size="xs" c="dimmed">These defaults apply to items that don&apos;t have their own settings</Text>

      <Select
        label="Default Action"
        data={ACTION_OPTIONS}
        value={formData.defaultAction || LIST_DEFAULTS.defaultAction}
        onChange={(value) => handleInputChange('defaultAction', value)}
      />

      <Box>
        <Text size="sm" fw={500} mb={4}>Default Volume</Text>
        <Group>
          <Slider
            style={{ flex: 1 }}
            min={0}
            max={100}
            value={formData.defaultVolume ?? 100}
            onChange={(value) => handleInputChange('defaultVolume', value === 100 ? null : value)}
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
            value={formData.defaultVolume ?? 100}
            onChange={(value) => handleInputChange('defaultVolume', value === 100 ? null : value)}
            suffix="%"
          />
        </Group>
      </Box>

      <Box>
        <Text size="sm" fw={500} mb={4}>Default Playback Rate</Text>
        <Group>
          <Slider
            style={{ flex: 1 }}
            min={0.5}
            max={3.0}
            step={0.1}
            value={formData.defaultPlaybackRate ?? 1.0}
            onChange={(value) => handleInputChange('defaultPlaybackRate', value === 1.0 ? null : value)}
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
            value={formData.defaultPlaybackRate ?? 1.0}
            onChange={(value) => handleInputChange('defaultPlaybackRate', value === 1.0 ? null : value)}
            suffix="x"
          />
        </Group>
      </Box>
    </>
  );
}

export default ListSettingsModal;
