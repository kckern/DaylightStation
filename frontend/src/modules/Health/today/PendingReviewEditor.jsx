import { useRef, useState } from 'react';
import { Button, Checkbox, NumberInput, Select, TextInput } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '@/lib/ui';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('pending-review');
const nutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
const label = key => `${key[0].toUpperCase()}${key.slice(1)} (${key === 'calories' ? 'kcal' : ['sodium', 'cholesterol'].includes(key) ? 'mg' : 'g'})`;

/** Holds the opened version while background refreshes continue. Never overwrite a draft. */
export function PendingReviewEditor({ entry, onClose, onChanged }) {
  const [factor, setFactor] = useState(1);
  const [draft, setDraft] = useState({});
  const [date, setDate] = useState(entry.date || '');
  const [mealTime, setMealTime] = useState(entry.mealTime || 'morning');
  const [nutritionReviewed, setNutritionReviewed] = useState(entry.nutritionLookup?.reviewed || false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const operation = useRef(null);
  const inFlight = useRef(false);
  const warnings = entry.nutritionLookup?.warnings || [];
  const missing = entry.nutritionLookup?.missing || [];
  const change = (id, key, value) => setDraft(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  const submit = async action => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const payload = { expectedVersion: entry.version, action, portionFactor: factor, date, mealTime,
      nutritionReviewed, items: Object.entries(draft).map(([id, changes]) => ({ id, ...changes })) };
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    try {
      await DaylightAPI(`api/v1/health/nutrition/pending/${entry.id}/review`,
        { ...payload, operationId: operation.current.id }, 'POST');
      logger.info('saved', { logId: entry.id, action });
      onChanged(); onClose();
    } catch (err) {
      logger.warn('failed', { logId: entry.id, action, error: err.message });
      setError(err);
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <Sheet open onClose={() => { if (!busy) onClose(); }} title="Review food">
    <div className="health-review">
      <p>Check the serving and nutrition, then confirm to add this food to your day.</p>
      {warnings.length ? <div role="note" className="health-review__warning">
        {warnings.map(warning => <p key={warning}>{warning}</p>)}
        <Checkbox label="I checked the nutrition against the product label" checked={nutritionReviewed}
          onChange={event => setNutritionReviewed(event.currentTarget.checked)} disabled={busy} />
      </div> : null}
      <NumberInput label="Servings" value={factor} min={0.01} max={100} decimalScale={2}
        onChange={setFactor} disabled={busy} />
      <div className="health-review__fields">
        <TextInput type="date" label="Date" value={date} onChange={event => setDate(event.currentTarget.value)} disabled={busy} />
        <Select label="Meal" data={BUCKETS.map(bucket => ({ value: bucket.id, label: bucket.label }))}
          value={mealTime} onChange={setMealTime} allowDeselect={false} disabled={busy} />
      </div>
      {entry.items.filter(item => item.kind !== 'group').map(item => {
        const values = draft[item.id] || {};
        return <fieldset key={item.id} disabled={busy}>
          <legend>{item.label}</legend>
          {item.originalQuantity?.amount ? <p>One serving: {item.originalQuantity.amount} {item.originalQuantity.unit}</p> : null}
          <TextInput label="Food name" value={values.label ?? item.label} onChange={event => change(item.id, 'label', event.currentTarget.value)} />
          <NumberInput label="Weight (g, if known)" value={values.grams ?? (item.grams ? item.grams * factor : '')}
            min={0.01} max={10000} onChange={value => change(item.id, 'grams', value === '' ? null : value)} />
          <div className="health-review__fields">
            {nutrients.map(key => <NumberInput key={key} label={label(key)} min={0}
              placeholder={missing.includes(key) ? 'Unknown — check label' : undefined}
              value={values[key] ?? (missing.includes(key) ? '' : Math.round((item[key] || 0) * factor * 100) / 100)}
              onChange={value => change(item.id, key, value)} />)}
          </div>
        </fieldset>;
      })}
      {error ? <div role="alert"><p>{error.message}</p><Button variant="subtle" onClick={() => { onChanged(); onClose(); }}>Reload review</Button></div> : null}
      <div className="health-pending__actions">
        <Button disabled={busy || !Number.isFinite(factor) || factor <= 0} loading={busy} onClick={() => submit('confirm')}>Confirm food</Button>
        <Button disabled={busy} variant="default" onClick={() => submit('save')}>Save changes</Button>
        <Button disabled={busy} variant="subtle" color="red" onClick={() => submit('discard')}>Discard</Button>
      </div>
    </div>
  </Sheet>;
}
