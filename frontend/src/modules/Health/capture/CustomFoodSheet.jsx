import { useRef, useState } from 'react';
import { Button, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { operationRequest } from './operationRequest.js';

const logger = createAppLogger('health').child('custom-food');

/** Unknown barcode → create a catalog food mapped to it → quick-add it. */
export function CustomFoodSheet({ upc, open, onClose, onCreated, bucketId = null, date = null }) {
  return open && upc ? <CustomFoodForm key={upc} upc={upc} onClose={onClose} onCreated={onCreated} bucketId={bucketId} date={date} /> : null;
}

function CustomFoodForm({ upc, onClose, onCreated, bucketId, date }) {
  const [form, setForm] = useState({ name: '', grams: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  const createRequest = useRef(null), logRequest = useRef(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null);
    try {
      const { entry } = await DaylightAPI('api/v1/health/nutrition/catalog',
        operationRequest(createRequest, { ...form, barcodeUpc: upc }), 'POST');
      // The scan that reached this sheet was launched from a specific meal on
      // a specific day; both were previously dropped on this branch, so a
      // custom food always landed in the clock's meal on the server's today.
      await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', operationRequest(logRequest, {
        catalogEntryId: entry.id,
        ...(bucketId ? { mealTime: bucketId } : {}),
        ...(date ? { date } : {}),
      }), 'POST');
      logger.info('custom.created', { name: form.name, upc, bucket: bucketId || undefined, date: date || undefined });
      onCreated();
    } catch (err) {
      logger.error('custom.failed', { error: err?.message });
      setError(err);
    } finally { pending.current = false; setBusy(false); }
  };

  return (
    <Sheet open onClose={() => { if (!pending.current) onClose(); }} title="New food">
      <Stack gap="xs">
        <Text size="sm" c="dimmed">Barcode {upc} isn't in any database — describe it once and it's yours forever.</Text>
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}
        <TextInput label="Name" value={form.name} onChange={set('name')} autoFocus data-autofocus />
        <NumberInput label="Weight in grams" suffix=" g" value={form.grams} onChange={set('grams')} min={0.01} />
        <NumberInput label="Calories at this weight" value={form.calories} onChange={set('calories')} min={0} />
        <NumberInput label="Protein g" value={form.protein} onChange={set('protein')} min={0} />
        <NumberInput label="Carbs g" value={form.carbs} onChange={set('carbs')} min={0} />
        <NumberInput label="Fat g" value={form.fat} onChange={set('fat')} min={0} />
        <Button loading={busy} disabled={!form.name.trim() || !(Number(form.grams) > 0)} onClick={save}>Create & log</Button>
      </Stack>
    </Sheet>
  );
}
export default CustomFoodSheet;
