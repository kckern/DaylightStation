import React, { useState, useEffect } from 'react';
import {
  Modal, TextInput, Switch, Chip, Group, Stack, Button,
  NumberInput, Box, Text
} from '@mantine/core';
import { DAYS_PRESETS, SECTION_DEFAULTS } from './listConstants.js';

function SectionSettingsModal({ opened, onClose, section, sectionIndex, onSave, loading }) {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (opened && section) {
      setFormData({
        title: section.title || '',
        shuffle: section.shuffle ?? SECTION_DEFAULTS.shuffle,
        continuous: section.continuous ?? SECTION_DEFAULTS.continuous,
        fixed_order: section.fixed_order ?? SECTION_DEFAULTS.fixed_order,
        limit: section.limit ?? SECTION_DEFAULTS.limit,
        days: section.days ?? SECTION_DEFAULTS.days,
        active: section.active ?? SECTION_DEFAULTS.active,
        playbackrate: section.playbackrate ?? SECTION_DEFAULTS.playbackrate,
        priority: section.priority ?? SECTION_DEFAULTS.priority,
        hold: section.hold ?? SECTION_DEFAULTS.hold,
      });
    }
  }, [opened, section]);

  const onChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {};
    for (const [key, val] of Object.entries(formData)) {
      if (val !== SECTION_DEFAULTS[key] && val !== '' && val !== null) {
        payload[key] = val;
      }
    }
    if (formData.title) payload.title = formData.title.trim();
    onSave(sectionIndex, payload);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Section Settings${section?.title ? `: ${section.title}` : ''}`} centered size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Title"
            placeholder="Section title"
            value={formData.title || ''}
            onChange={(e) => onChange('title', e.target.value)}
          />

          <Group grow>
            <Switch label="Shuffle" checked={!!formData.shuffle} onChange={(e) => onChange('shuffle', e.target.checked)} />
            <Switch label="Continuous" checked={!!formData.continuous} onChange={(e) => onChange('continuous', e.target.checked)} />
            <Switch label="Fixed Order" checked={!!formData.fixed_order} onChange={(e) => onChange('fixed_order', e.target.checked)} />
          </Group>

          <Switch label="Active" description="Inactive sections are hidden" checked={formData.active !== false} onChange={(e) => onChange('active', e.target.checked)} />

          <Switch label="Hold" description="Prevent automatic progression" checked={!!formData.hold} onChange={(e) => onChange('hold', e.target.checked)} />

          <NumberInput
            label="Limit"
            description="Max items to select (for shuffle sections)"
            placeholder="No limit"
            min={1}
            value={formData.limit || ''}
            onChange={(val) => onChange('limit', val || null)}
          />

          <Box>
            <Text size="sm" fw={500} mb={8}>Days</Text>
            <Chip.Group value={formData.days || null} onChange={(value) => onChange('days', value || null)}>
              <Group gap="xs">
                {DAYS_PRESETS.map((preset) => (
                  <Chip key={preset.value || 'any'} value={preset.value} variant="outline">
                    {preset.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Box>

          <NumberInput
            label="Priority"
            description="Higher priority sections are preferred"
            placeholder="Default"
            value={formData.priority || ''}
            onChange={(val) => onChange('priority', val || null)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Save Section</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default SectionSettingsModal;
