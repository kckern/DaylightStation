import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  TextInput,
  Select,
  Switch,
  Group,
  Stack,
  Button,
  FileInput,
  Image,
  SegmentedControl,
  Text,
  Box
} from '@mantine/core';
import { IconUpload, IconSettings, IconSettingsAutomation } from '@tabler/icons-react';
import EditorCategories from './EditorCategories.jsx';
import ContentSearchCombobox from './ContentSearchCombobox.jsx';
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
function SimpleMode({ formData, onChange, errors, existingGroups, imageFile, onImageUpload, uploading }) {
  const groupOptions = existingGroups
    .filter(g => g)
    .map(g => ({ value: g, label: g }));

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

      <FileInput
        label="Image"
        description="Optional thumbnail image"
        placeholder="Click to upload"
        leftSection={<IconUpload size={16} />}
        accept="image/jpeg,image/png,image/webp"
        value={imageFile}
        onChange={onImageUpload}
        error={errors.image}
      />

      {formData.image && (
        <Image
          src={formData.image}
          height={100}
          fit="contain"
          radius="sm"
        />
      )}
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
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
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
      setImageFile(null);
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

  const handleImageUpload = async (file) => {
    if (!file) {
      setImageFile(null);
      return;
    }

    setImageFile(file);
    setUploading(true);

    try {
      const formDataObj = new FormData();
      formDataObj.append('image', file);

      const response = await fetch('/api/v1/admin/images/upload', {
        method: 'POST',
        body: formDataObj
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      handleInputChange('image', result.path);
    } catch (err) {
      setErrors(prev => ({ ...prev, image: 'Failed to upload image' }));
    } finally {
      setUploading(false);
    }
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
              imageFile={imageFile}
              onImageUpload={handleImageUpload}
              uploading={uploading}
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
            <Button type="submit" loading={loading || uploading} data-testid="save-item-button">
              {item ? 'Save Changes' : 'Add Item'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListsItemEditor;
