import React, { useState, useEffect } from 'react';
import {
  Modal,
  TextInput,
  Textarea,
  Select,
  Chip,
  Switch,
  Slider,
  Group,
  Stack,
  Button,
  NumberInput,
  Box,
  Text
} from '@mantine/core';
import {
  ACTION_OPTIONS,
  SORTING_OPTIONS,
  DAYS_PRESETS,
  LIST_DEFAULTS
} from './listConstants.js';

/**
 * Build save payload with only non-default values
 */
function buildSavePayload(formData) {
  const payload = {};

  // Always include title if set
  if (formData.title?.trim()) {
    payload.title = formData.title.trim();
  }

  // Include description if set
  if (formData.description?.trim()) {
    payload.description = formData.description.trim();
  }

  // Include group if set
  if (formData.group?.trim()) {
    payload.group = formData.group.trim();
  }

  // Include icon if set
  if (formData.icon?.trim()) {
    payload.icon = formData.icon.trim();
  }

  // Include sorting if different from default
  if (formData.sorting && formData.sorting !== LIST_DEFAULTS.sorting) {
    payload.sorting = formData.sorting;
  }

  // Include days if set
  if (formData.days) {
    payload.days = formData.days;
  }

  // Include active if false (default is true)
  if (formData.active === false) {
    payload.active = false;
  }

  // Include defaultAction if different from default
  if (formData.defaultAction && formData.defaultAction !== LIST_DEFAULTS.defaultAction) {
    payload.defaultAction = formData.defaultAction;
  }

  // Include defaultVolume if set
  if (formData.defaultVolume !== null && formData.defaultVolume !== undefined) {
    payload.defaultVolume = formData.defaultVolume;
  }

  // Include defaultPlaybackRate if set
  if (formData.defaultPlaybackRate !== null && formData.defaultPlaybackRate !== undefined) {
    payload.defaultPlaybackRate = formData.defaultPlaybackRate;
  }

  return payload;
}

/**
 * ListSettingsModal - Modal for editing list-level settings
 *
 * @param {boolean} opened - Whether the modal is open
 * @param {Function} onClose - Callback to close modal
 * @param {Object} metadata - Current list metadata object
 * @param {Function} onSave - Callback with settings object: (settings) => void
 * @param {boolean} loading - Boolean for save loading state
 * @param {string[]} existingGroups - List of existing group names for autocomplete
 */
function ListSettingsModal({
  opened,
  onClose,
  metadata,
  onSave,
  loading,
  existingGroups = []
}) {
  const [formData, setFormData] = useState({});

  // Reset form when modal opens
  useEffect(() => {
    if (opened) {
      setFormData({
        title: metadata?.title || '',
        description: metadata?.description || '',
        group: metadata?.group || '',
        icon: metadata?.icon || '',
        sorting: metadata?.sorting || LIST_DEFAULTS.sorting,
        days: metadata?.days || null,
        active: metadata?.active !== false,
        defaultAction: metadata?.defaultAction || LIST_DEFAULTS.defaultAction,
        defaultVolume: metadata?.defaultVolume ?? null,
        defaultPlaybackRate: metadata?.defaultPlaybackRate ?? null
      });
    }
  }, [opened, metadata]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = buildSavePayload(formData);
    onSave(payload);
  };

  // Build group options from existing groups
  const groupOptions = existingGroups
    .filter(g => g)
    .map(g => ({ value: g, label: g }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="List Settings"
      centered
      size="lg"
    >
      <form onSubmit={handleSubmit}>
        <Stack>
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
            <Select
              label="Group"
              description="Category for organizing lists"
              placeholder="Select or type a group"
              data={groupOptions}
              value={formData.group || ''}
              onChange={(value) => handleInputChange('group', value || '')}
              searchable
              creatable
              getCreateLabel={(query) => `+ Create "${query}"`}
              onCreate={(query) => {
                groupOptions.push({ value: query, label: query });
                return query;
              }}
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
          <Text size="xs" c="dimmed">These defaults apply to items that don't have their own settings</Text>

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

          {/* Action Buttons */}
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading} data-testid="save-list-settings-button">
              Save Settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListSettingsModal;
