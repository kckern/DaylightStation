import { useEffect, useRef, useState } from 'react';
import { Button, Group, NumberInput, SegmentedControl, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { foodGrams, NUTRIENT_KEYS, scaleFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { BUCKETS } from './mealBuckets.js';
import { FoodIcon } from './FoodIcon.jsx';
import { ObservationRow } from './ObservationRow.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';

const logger = createAppLogger('health').child('entry-editor');
const nameOf = row => row.name || row.item || row.label || '';
const identity = row => row.uuid || row.id;
const factors = [0.5, 0.75, 1.5, 2];

export function EntryEditor({ row, open, ...props }) {
  return open && row ? <Editor key={identity(row)} row={row} {...props} /> : null;
}

function Editor({ row, onClose, onChanged, onDeleted, onCoach, observations = [], onPaired }) {
  const children = row.kind === 'group' ? row.children || [] : [];
  const isGroup = row.kind === 'group';
  const original = isGroup ? {
    grams: children.every(child => foodGrams(child) !== null) ? children.reduce((sum, child) => sum + foodGrams(child), 0) : null,
    ...Object.fromEntries(NUTRIENT_KEYS.map(key => [key, children.reduce((sum, child) => sum + (child[key] || 0), 0)])),
  } : row;
  const originalGrams = foodGrams(original);
  const [name, setName] = useState(nameOf(row));
  const [grams, setGrams] = useState(originalGrams ?? '');
  const [mealTime, setMealTime] = useState(row.mealTime);
  const [date, setDate] = useState(row.date);
  const [icon, setIcon] = useState(row.icon);
  const [overrides, setOverrides] = useState({});
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [icons, setIcons] = useState([]);
  const pending = useRef(false);
  const factor = originalGrams && Number(grams) > 0 ? Number(grams) / originalGrams : 1;
  const nutrients = { ...scaleFoodPortion(original, factor), ...overrides };

  useEffect(() => {
    if (isGroup) return;
    let live = true;
    DaylightAPI(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(nameOf(row))}`)
      .then(result => { if (live) setFavorite(Boolean(result?.items?.find(item => row.foodId ? item.id === row.foodId : item.name?.toLowerCase() === nameOf(row).toLowerCase())?.favorite)); })
      .catch(err => { if (live) setError(err); });
    return () => { live = false; };
  }, [row, isGroup]);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    DaylightAPI(`api/v1/health/nutrition/icons?q=${encodeURIComponent(query)}&limit=60`)
      .then(result => { if (live) setIcons(result.icons || []); })
      .catch(err => { if (live) setError(err); });
    return () => { live = false; };
  }, [picking, query]);

  const run = async (action, { close = false } = {}) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await action(); onChanged();
      if (close) onClose();
    } catch (err) { logger.warn('entry.command_failed', { id: identity(row), error: err.message }); setError(err); }
    finally { pending.current = false; setBusy(false); }
  };

  const save = () => run(() => DaylightAPI(`api/v1/health/nutrilist/${identity(row)}`, {
    name: name.trim(), mealTime, date, icon,
    expectedVersion: row.version ?? 1,
    correctedNutrients: Object.keys(overrides),
    ...(isGroup ? (factor !== 1 ? { factor } : {}) : {
      ...(grams !== '' ? { grams: Number(grams), amount: Number(grams), unit: 'g' } : {}),
      ...nutrients,
      // Unknown original mass cannot establish a density; preserve its totals.
      ...(grams !== '' ? { grams: Number(grams) } : {}),
    }),
  }, 'PUT'), { close: true });

  return <Sheet open onClose={() => { if (!busy) onClose(); }} title={nameOf(row)}>
    <Stack gap="xs">
      {error ? <Text role="alert" size="sm" c="red">{error.message}</Text> : null}
      <Group wrap="nowrap" gap="xs">
        <UnstyledButton aria-label="Change food icon" onClick={() => setPicking(value => !value)} disabled={busy}><FoodIcon icon={icon} /></UnstyledButton>
        <TextInput label="Name" value={name} onChange={event => setName(event.target.value)} disabled={busy} style={{ flex: 1 }} />
      </Group>
      <NumberInput label={isGroup ? 'Whole dish weight' : 'Weight'} suffix=" g" aria-label="Weight in grams"
        data-autofocus min={0.01} decimalScale={2} value={grams} disabled={busy || (isGroup && !originalGrams)}
        placeholder="Weight unknown" onChange={setGrams} onFocus={event => event.target.select()}
        onKeyDown={event => { if (event.key === 'Enter' && name.trim() && !busy) save(); }} />
      <Group gap="xs">
        {factors.map(value => <Button key={value} size="compact-xs" variant="light" disabled={busy || !originalGrams}
          onClick={() => setGrams(Math.round((Number(grams) || originalGrams) * value * 100) / 100)}>×{value}</Button>)}
      </Group>
      <Text size="sm">{Math.round(nutrients.calories || 0)} kcal · P {Math.round(nutrients.protein || 0)} g · C {Math.round(nutrients.carbs || 0)} g · F {Math.round(nutrients.fat || 0)} g</Text>
      <SegmentedControl aria-label="Meal" size="xs" fullWidth value={mealTime || ''} disabled={busy}
        data={BUCKETS.map(bucket => ({ value: bucket.id, label: bucket.label }))} onChange={setMealTime} />
      {picking ? <>
        <TextInput aria-label="Search icons" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="health-icon-grid">{icons.map(slug => <UnstyledButton key={slug} aria-label={slug} aria-pressed={icon === slug}
          className="health-icon-grid__cell" onClick={() => { setIcon(slug); setPicking(false); }}><FoodIcon icon={slug} /></UnstyledButton>)}</div>
      </> : null}
      <details className="health-edit__advanced"><summary>Nutrition, date &amp; evidence</summary>
        <Stack gap="xs" mt="xs">
          {onCoach ? <Button size="compact-xs" variant="light" onClick={onCoach} disabled={busy}>Ask coach about this entry</Button> : null}
          <TextInput label="Date" type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)} />
          {!isGroup ? <Group gap="xs">
            <Button size="compact-xs" variant="light" disabled={busy} onClick={() => run(() => DaylightAPI('api/v1/health/nutrition/catalog/icon', {
              ...(row.foodId ? { id: row.foodId } : { name: nameOf(row) }), icon,
            }, 'PUT'))}>Use icon for this food</Button>
            <Button size="compact-xs" variant="light" disabled={busy} onClick={() => run(() => DaylightAPI('api/v1/health/nutrition/templates', {
              name: name.trim(), components: [{ ...row, ...nutrients, name: name.trim(), icon, grams: Number(grams) || null, role: 'core' }],
            }, 'POST'))}>Save as meal</Button>
          </Group> : null}
          {!isGroup ? NUTRIENT_KEYS.map(key => <NumberInput key={key} label={`${key}${key === 'calories' ? ' (kcal)' : ['sodium', 'cholesterol'].includes(key) ? ' (mg)' : ' (g)'}`}
            min={0} value={nutrients[key] ?? ''} disabled={busy} onChange={value => setOverrides(previous => ({ ...previous, [key]: value === '' ? null : value }))} />) : null}
          {row.photoRef ? <img className="health-edit__photo" src={nutritionPhotoUrl(row.photoRef)} alt="Food capture" /> : null}
          {!isGroup ? observations.filter(observation => observation.status !== 'dismissed').map(observation => <ObservationRow key={observation.id}
            observation={observation} attached={observation.pairedEntryUuid === identity(row)}
            blocked={observation.pairedEntryUuid && observation.pairedEntryUuid !== identity(row) ? 'Attached to another entry' : null}
            onPair={() => run(async () => {
              await DaylightAPI(`api/v1/health/nutrition/observations/${observation.id}/pair`, { entryUuid: identity(row) }, 'POST');
              onPaired?.(); onClose();
            })} />) : null}
        </Stack>
      </details>
      <Group justify="space-between" gap="xs">
        {!isGroup ? <Button size="compact-xs" variant="subtle" disabled={busy} aria-label="favorite" aria-pressed={favorite}
          onClick={() => run(async () => {
            await DaylightAPI('api/v1/health/nutrition/catalog/favorite', { name: nameOf(row), favorite: !favorite }, 'PUT');
            setFavorite(value => !value);
          })}>{favorite ? '★ Favorited' : '☆ Favorite'}</Button> : <span />}
        <Button size="compact-xs" color="red" variant="subtle" disabled={busy} onClick={() => run(async () => {
          const result = await DaylightAPI(`api/v1/health/nutrilist/${identity(row)}`, {}, 'DELETE');
          onDeleted?.({ entryIds: result.affectedIds || [identity(row)], label: nameOf(row) });
        }, { close: true })}>Delete</Button>
      </Group>
      <Group justify="flex-end" gap="xs">
        <Button size="sm" variant="subtle" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={busy} disabled={!name.trim() || (grams !== '' && !(Number(grams) > 0))} onClick={save}>Save</Button>
      </Group>
    </Stack>
  </Sheet>;
}
