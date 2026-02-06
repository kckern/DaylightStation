import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  TextInput,
  Select,
  Switch,
  Group,
  Stack,
  Button,
  Image,
  SegmentedControl,
  Text,
  Box,
  UnstyledButton
} from '@mantine/core';
import { IconSettings, IconSettingsAutomation, IconPhoto } from '@tabler/icons-react';
import EditorCategories from './EditorCategories.jsx';
import ContentSearchCombobox from './ContentSearchCombobox.jsx';
import ImagePickerModal from './ImagePickerModal.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import { ACTION_OPTIONS, KNOWN_ITEM_FIELDS, ITEM_DEFAULTS } from './listConstants.js';

/**
 * Extract custom fields from an item (fields not in KNOWN_ITEM_FIELDS)
 */
function extractCustomFields(item) {
  if (!item) return {};
  const custom = {};
  for (const key of Object.keys(item)) {
    if (!KNOWN_ITEM_FIELDS.includes(key)) {
      custom[key] = item[key];
    }
  }
  return custom;
}

/**
 * Build save payload with only non-default values
 * Always includes label and input as they are required
 */
function buildSavePayload(formData, customFields) {
  const payload = {
    label: formData.label?.trim() || '',
    input: formData.input?.trim() || ''
  };

  // Add non-default values
  for (const [key, defaultValue] of Object.entries(ITEM_DEFAULTS)) {
    const currentValue = formData[key];

    // Skip if value matches default
    if (currentValue === defaultValue) continue;
    if (currentValue === null && defaultValue === null) continue;
    if (currentValue === undefined) continue;

    // Special handling for booleans - only include if different from default
    if (typeof defaultValue === 'boolean') {
      if (currentValue !== defaultValue) {
        payload[key] = currentValue;
      }
      continue;
    }

    // Special handling for numbers - only include if different from default
    if (typeof defaultValue === 'number') {
      if (currentValue !== null && currentValue !== defaultValue) {
        payload[key] = currentValue;
      }
      continue;
    }

    // For strings and other values
    if (currentValue !== null && currentValue !== '') {
      payload[key] = currentValue;
    }
  }

  // Add group and image if they have values (not in ITEM_DEFAULTS)
  if (formData.group && formData.group.trim()) {
    payload.group = formData.group.trim();
  }
  if (formData.image) {
    payload.image = formData.image;
  }

  // Merge custom fields
  for (const [key, value] of Object.entries(customFields)) {
    if (value !== undefined && value !== null && value !== '') {
      payload[key] = value;
    }
  }

  return payload;
}

/**
 * Simple mode - Just the essential fields
 */
function SimpleMode({ formData, onChange, errors, existingGroups }) {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const groupOptions = existingGroups
    .filter(g => g)
    .map(g => ({ value: g, label: g }));

  const imageSrc = formData.image
    ? (formData.image.startsWith('/media/') || formData.image.startsWith('media/')
        ? DaylightMediaPath(formData.image)
        : formData.image)
    : null;

  return (
    <Stack>
      <TextInput
        label="Label"
        placeholder="e.g., Raising Kids Emotionally"
        value={formData.label}
        onChange={(e) => onChange('label', e.target.value)}
        error={errors.label}
        required
        data-autofocus
        data-testid="item-label-input"
      />

      <Box>
        <Text size="sm" fw={500} mb={4}>Input <Text span c="red">*</Text></Text>
        <ContentSearchCombobox
          value={formData.input}
          onChange={(val) => onChange('input', val)}
          placeholder="Search content or type source:id"
        />
        <Text size="xs" c="dimmed" mt={4}>
          Search or type directly: plex:123, media:path, youtube:xyz
        </Text>
        {errors.input && <Text size="xs" c="red" mt={4}>{errors.input}</Text>}
      </Box>

      <Select
        label="Action"
        data={ACTION_OPTIONS}
        value={formData.action}
        onChange={(value) => onChange('action', value)}
      />

      <Select
        label="Group"
        description="Optional grouping for organization"
        placeholder="Select or type a group"
        data={groupOptions}
        value={formData.group}
        onChange={(value) => onChange('group', value || '')}
        searchable
        creatable
        getCreateLabel={(query) => `+ Create "${query}"`}
        onCreate={(query) => {
          groupOptions.push({ value: query, label: query });
          return query;
        }}
        clearable
      />

      <Switch
        label="Active"
        description="Inactive items are hidden from lists"
        checked={formData.active}
        onChange={(e) => onChange('active', e.target.checked)}
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
            {formData.image ? 'Change Image' : 'Set Image'}
          </Button>
        </Group>
        {errors.image && <Text size="xs" c="red" mt={4}>{errors.image}</Text>}
        <ImagePickerModal
          opened={imagePickerOpen}
          onClose={() => setImagePickerOpen(false)}
          currentImage={formData.image || null}
          inheritedImage={null}
          onSave={(path) => onChange('image', path)}
        />
      </Box>
    </Stack>
  );
}

/**
 * ListsItemEditor - Modal for editing list items with Simple/Full mode toggle
 */
function ListsItemEditor({ opened, onClose, onSave, item, loading, existingGroups = [], isWatchlist = false }) {
  const [mode, setMode] = useState('simple');
  const [formData, setFormData] = useState({});
  const [customFields, setCustomFields] = useState({});
  const [errors, setErrors] = useState({});

  // Reset form when modal opens
  useEffect(() => {
    if (opened) {
      if (item) {
        // Load existing item
        setFormData({
          label: item.label || '',
          input: item.input || '',
          action: item.action || ITEM_DEFAULTS.action,
          active: item.active !== false,
          image: item.image || null,
          group: item.group || '',
          // Playback
          shuffle: item.shuffle ?? ITEM_DEFAULTS.shuffle,
          continuous: item.continuous ?? ITEM_DEFAULTS.continuous,
          loop: item.loop ?? ITEM_DEFAULTS.loop,
          fixedOrder: item.fixedOrder ?? ITEM_DEFAULTS.fixedOrder,
          volume: item.volume ?? ITEM_DEFAULTS.volume,
          playbackRate: item.playbackRate ?? ITEM_DEFAULTS.playbackRate,
          // Scheduling
          days: item.days ?? ITEM_DEFAULTS.days,
          snooze: item.snooze ?? ITEM_DEFAULTS.snooze,
          waitUntil: item.waitUntil ?? ITEM_DEFAULTS.waitUntil,
          // Display
          shader: item.shader ?? ITEM_DEFAULTS.shader,
          composite: item.composite ?? ITEM_DEFAULTS.composite,
          playable: item.playable ?? ITEM_DEFAULTS.playable,
          // Progress
          progress: item.progress ?? ITEM_DEFAULTS.progress,
          watched: item.watched ?? ITEM_DEFAULTS.watched
        });
        setCustomFields(extractCustomFields(item));
      } else {
        // New item - start with defaults
        setFormData({
          label: '',
          input: '',
          action: ITEM_DEFAULTS.action,
          active: ITEM_DEFAULTS.active,
          image: null,
          group: '',
          shuffle: ITEM_DEFAULTS.shuffle,
          continuous: ITEM_DEFAULTS.continuous,
          loop: ITEM_DEFAULTS.loop,
          fixedOrder: ITEM_DEFAULTS.fixedOrder,
          volume: ITEM_DEFAULTS.volume,
          playbackRate: ITEM_DEFAULTS.playbackRate,
          days: ITEM_DEFAULTS.days,
          snooze: ITEM_DEFAULTS.snooze,
          waitUntil: ITEM_DEFAULTS.waitUntil,
          shader: ITEM_DEFAULTS.shader,
          composite: ITEM_DEFAULTS.composite,
          playable: ITEM_DEFAULTS.playable,
          progress: ITEM_DEFAULTS.progress,
          watched: ITEM_DEFAULTS.watched
        });
        setCustomFields({});
      }
      setErrors({});
      setMode('simple');
    }
  }, [opened, item]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const handleCustomFieldChange = (key, value) => {
    setCustomFields(prev => {
      if (value === undefined) {
        // Delete the field
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: value };
    });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.label?.trim()) {
      newErrors.label = 'Label is required';
    }
    if (!formData.input?.trim()) {
      newErrors.input = 'Input is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = buildSavePayload(formData, customFields);
    await onSave(payload);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={item ? 'Edit Item' : 'Add Item'}
      centered
      size={mode === 'full' ? 'lg' : 'md'}
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          {/* Mode Toggle */}
          <Box>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              data={[
                {
                  value: 'simple',
                  label: (
                    <Group gap="xs">
                      <IconSettingsAutomation size={16} />
                      <Text size="sm">Simple</Text>
                    </Group>
                  )
                },
                {
                  value: 'full',
                  label: (
                    <Group gap="xs">
                      <IconSettings size={16} />
                      <Text size="sm">Full</Text>
                    </Group>
                  )
                }
              ]}
              fullWidth
            />
          </Box>

          {/* Form Content */}
          {mode === 'simple' ? (
            <SimpleMode
              formData={formData}
              onChange={handleInputChange}
              errors={errors}
              existingGroups={existingGroups}
            />
          ) : (
            <EditorCategories
              item={formData}
              onChange={handleInputChange}
              customFields={customFields}
              onCustomFieldChange={handleCustomFieldChange}
              isWatchlist={isWatchlist}
              existingGroups={existingGroups}
            />
          )}

          {/* Action Buttons */}
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading} data-testid="save-item-button">
              {item ? 'Save Changes' : 'Add Item'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListsItemEditor;
