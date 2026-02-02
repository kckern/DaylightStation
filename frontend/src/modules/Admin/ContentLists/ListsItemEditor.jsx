import React, { useState, useEffect, useMemo } from 'react';
import { Modal, TextInput, Select, Switch, Group, Stack, Button, FileInput, Image } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';

const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];

function ListsItemEditor({ opened, onClose, onSave, item, loading, existingGroups = [] }) {
  const [formData, setFormData] = useState({
    label: '',
    input: '',
    action: 'Play',
    active: true,
    image: null,
    group: ''
  });
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});

  // Build group options from existing groups
  const groupOptions = existingGroups
    .filter(g => g) // Remove empty/null
    .map(g => ({ value: g, label: g }));

  // Reset form when modal opens
  useEffect(() => {
    if (opened) {
      if (item) {
        setFormData({
          label: item.label || '',
          input: item.input || '',
          action: item.action || 'Play',
          active: item.active !== false,
          image: item.image || null,
          group: item.group || ''
        });
      } else {
        setFormData({
          label: '',
          input: '',
          action: 'Play',
          active: true,
          image: null,
          group: ''
        });
      }
      setImageFile(null);
      setErrors({});
    }
  }, [opened, item]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
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
    if (!formData.label.trim()) {
      newErrors.label = 'Label is required';
    }
    if (!formData.input.trim()) {
      newErrors.input = 'Input is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const data = {
      label: formData.label.trim(),
      input: formData.input.trim(),
      action: formData.action,
      active: formData.active,
      image: formData.image
    };

    // Only include group if it has a value
    if (formData.group.trim()) {
      data.group = formData.group.trim();
    }

    await onSave(data);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={item ? 'Edit Item' : 'Add Item'}
      centered
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Label"
            placeholder="e.g., Raising Kids Emotionally"
            value={formData.label}
            onChange={(e) => handleInputChange('label', e.target.value)}
            error={errors.label}
            required
            data-autofocus
            data-testid="item-label-input"
          />

          <TextInput
            label="Input"
            placeholder="e.g., plex:311549 or media:path/to/file"
            description="Format: source:id (plex:123, media:path, youtube:xyz)"
            value={formData.input}
            onChange={(e) => handleInputChange('input', e.target.value)}
            error={errors.input}
            required
            data-testid="item-input-input"
          />

          <Select
            label="Action"
            data={ACTION_OPTIONS}
            value={formData.action}
            onChange={(value) => handleInputChange('action', value)}
          />

          <Select
            label="Group"
            description="Optional grouping for organization"
            placeholder="Select or type a group"
            data={groupOptions}
            value={formData.group}
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

          <Switch
            label="Active"
            description="Inactive items are hidden from lists"
            checked={formData.active}
            onChange={(e) => handleInputChange('active', e.target.checked)}
          />

          <FileInput
            label="Image"
            description="Optional thumbnail image"
            placeholder="Click to upload"
            leftSection={<IconUpload size={16} />}
            accept="image/jpeg,image/png,image/webp"
            value={imageFile}
            onChange={handleImageUpload}
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
