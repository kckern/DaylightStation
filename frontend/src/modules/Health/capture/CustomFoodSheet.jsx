import { useState } from 'react';
import { Button, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('custom-food');

/** Unknown barcode → create a catalog food mapped to it → quick-add it. */
export function CustomFoodSheet({ upc, open, onClose, onCreated, bucketId = null, date = null }) {
  const [form, setForm] = useState({ name: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { entry } = await DaylightAPI('api/v1/health/nutrition/catalog',
        { ...form, barcodeUpc: upc }, 'POST');
      // The scan that reached this sheet was launched from a specific meal on
      // a specific day; both were previously dropped on this branch, so a
      // custom food always landed in the clock's meal on the server's today.
      await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', {
        catalogEntryId: entry.id,
        ...(bucketId ? { mealTime: bucketId } : {}),
        ...(date ? { date } : {}),
      }, 'POST');
      logger.info('custom.created', { name: form.name, upc, bucket: bucketId || undefined, date: date || undefined });
      onCreated();
    } catch (err) {
      logger.error('custom.failed', { error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New food">
      <Stack gap="xs">
        <Text size="sm" c="dimmed">Barcode {upc} isn't in any database — describe it once and it's yours forever.</Text>
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}
        <TextInput label="Name" value={form.name} onChange={set('name')} autoFocus data-autofocus />
        <NumberInput label="Calories (per serving)" value={form.calories} onChange={set('calories')} min={0} />
        <NumberInput label="Protein g" value={form.protein} onChange={set('protein')} min={0} />
        <NumberInput label="Carbs g" value={form.carbs} onChange={set('carbs')} min={0} />
        <NumberInput label="Fat g" value={form.fat} onChange={set('fat')} min={0} />
        <Button loading={busy} disabled={!form.name.trim()} onClick={save}>Create & log</Button>
      </Stack>
    </Sheet>
  );
}
export default CustomFoodSheet;
