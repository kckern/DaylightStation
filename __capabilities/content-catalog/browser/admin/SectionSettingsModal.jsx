import React from 'react';
import { FormDialog } from '../../../../frontend/src/lib/ui/FormDialog.jsx';
import {
  TextInput, Switch, Chip, Group,
  NumberInput, Box, Text
} from '@mantine/core';
import { SettingsDialogForm } from './SettingsDialogForm.jsx';
import { DAYS_PRESETS, SECTION_DEFAULTS } from "./listConstants.js";

function SectionSettingsModal({ opened, onClose, section, onSave, loading, read }) {
  const confirmed = {
    title: section?.title || '',
    shuffle: section?.shuffle ?? SECTION_DEFAULTS.shuffle,
    continuous: section?.continuous ?? SECTION_DEFAULTS.continuous,
    fixed_order: section?.fixed_order ?? SECTION_DEFAULTS.fixed_order,
    limit: section?.limit ?? SECTION_DEFAULTS.limit,
    days: section?.days ?? SECTION_DEFAULTS.days,
    active: section?.active ?? SECTION_DEFAULTS.active,
    playbackrate: section?.playbackrate ?? SECTION_DEFAULTS.playbackrate,
    priority: section?.priority ?? SECTION_DEFAULTS.priority,
    hold: section?.hold ?? SECTION_DEFAULTS.hold,
  };
  return (
    <FormDialog opened={opened} onClose={onClose} title={`Section Settings${section?.title ? `: ${section.title}` : ''}`} centered size="md">
      {opened && (
        <SettingsDialogForm source={section} confirmed={confirmed} defaults={SECTION_DEFAULTS}
          loading={loading} read={read} recoveryLabel="Section settings recovery" onClose={onClose}
          onSave={onSave} saveLabel="Save Section">
          {(formData, onChange) => <SectionSettingsFields formData={formData} onChange={onChange} />}
        </SettingsDialogForm>
      )}
    </FormDialog>
  );
}

function SectionSettingsFields({ formData, onChange }) {
  return (
    <>
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
    </>
  );
}

export default SectionSettingsModal;
