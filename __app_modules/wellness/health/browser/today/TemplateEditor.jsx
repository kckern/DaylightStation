import { useState } from 'react';
import { Button, Group, NumberInput, Stack, Text, TextInput, SegmentedControl } from '@mantine/core';
import { SubmitButton, useSheetSubmission } from '@/lib/ui';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { scaleFoodPortion, NUTRIENT_KEYS } from "../../portable/contracts/health/foodQuantity.mjs";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";

const logger = createAppLogger('health').child('template-editor');

export function TemplateEditor({ template, onCommitted, onClose, onCancel }) {
  const [draft, setDraft] = useState(() => structuredClone(template));
  const { run, saving: busy, failure: error } = useSheetSubmission(onClose, error => {
    logger.warn('template.save_failed', { id: template.id, error: error.message });
  });
  const valid = Boolean(draft.name.trim() && draft.components.length);
  const update = (index, changes) => setDraft(previous => ({ ...previous,
    components: previous.components.map((component, i) => i === index ? { ...component, ...changes } : component) }));
  const save = () => run(async () => {
    await DaylightAPI(`api/v1/health/nutrition/templates/${template.id}`, { name: draft.name, components: draft.components }, 'PUT');
    logger.info('template.saved', { id: template.id });
    onCommitted();
  }, { valid });
  return <Stack gap="xs">
    {error ? <Text c="red" role="alert">{error.message}</Text> : null}
    <TextInput label="Meal name" value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} disabled={busy} />
    {draft.components.map((component, index) => <Stack key={index} gap={4}>
      <Group gap="xs" wrap="nowrap">
        <TextInput aria-label={`Component ${index + 1} name`} value={component.name} onChange={event => update(index, { name: event.target.value })} disabled={busy} />
        <NumberInput aria-label={`${component.name || 'Component'} grams`} suffix=" g" min={0.01} value={component.grams || ''} disabled={busy}
          onChange={grams => update(index, { ...(component.grams > 0 && grams > 0 ? scaleFoodPortion(component, grams / component.grams) : {}), grams })} />
        <Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={() => setDraft(previous => ({ ...previous, components: previous.components.filter((_, i) => i !== index) }))}>Remove</Button>
      </Group>
      <SegmentedControl aria-label={`${component.name || `Component ${index + 1}`} meal inclusion`}
        size="xs" value={component.role || 'core'} data={[{ label: 'Always', value: 'core' }, { label: 'Optional', value: 'variant' }]} onChange={role => update(index, { role })} disabled={busy} />
      <details><summary>Nutrition</summary><Group gap="xs">{NUTRIENT_KEYS.map(key =>
        <NumberInput key={key} label={key} min={0} value={component[key] ?? ''} disabled={busy} onChange={value => update(index, {
          [key]: value === '' ? null : value, correctedNutrients: [...new Set([...(component.correctedNutrients || []), key])],
        })} />)}</Group></details>
    </Stack>)}
    <Button size="compact-xs" variant="light" disabled={busy} onClick={() => setDraft(previous => ({ ...previous, components: [...previous.components, { name: '', grams: '', role: 'core' }] }))}>Add component</Button>
    <Group justify="flex-end">
      <Button variant="subtle" disabled={busy} onClick={onCancel}>Cancel</Button>
      <SubmitButton as={Button} type="button" pending={busy} disabled={!valid} onClick={save}>Save meal</SubmitButton>
    </Group>
  </Stack>;
}
