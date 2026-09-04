import { useRef, useState } from 'react';
import { Button, Group, NumberInput, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { Sheet, ErrorState, LoadingState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { NUTRIENT_KEYS } from '@shared-contracts/health/foodQuantity.mjs';
import { FoodIcon } from './FoodIcon.jsx';

const logger = createAppLogger('health').child('food-manager');
export function FoodCatalogManager({ open, ...props }) {
  return open ? <Manager {...props} /> : null;
}
function Manager({ onClose, onChanged }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  const foods = useApiResource(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(query)}&limit=40`, { logger, swr: true });
  const run = async action => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await action(); setDraft(null); foods.reload(); onChanged(); }
    catch (err) { logger.warn('food.command_failed', { error: err.message }); setError(err); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Sheet open title="Saved foods" onClose={() => { if (!pending.current) onClose(); }}>
    <Stack gap="xs">
      <Text size="sm" c="dimmed">These definitions apply to future logging. Your past entries keep their original nutrition.</Text>
      {error ? <Text c="red" role="alert">{error.message}</Text> : null}
      {draft ? <>
        <TextInput label="Food name" value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} disabled={busy} />
        <NumberInput label="Nutrition basis in grams" suffix=" g" min={0.01} value={draft.grams ?? ''} onChange={grams => setDraft(previous => ({ ...previous, grams }))} disabled={busy} />
        {NUTRIENT_KEYS.map(key => <NumberInput key={key} label={key} min={0} disabled={busy} value={draft.nutrients?.[key] ?? ''}
          onChange={value => setDraft(previous => ({ ...previous, nutrients: { ...previous.nutrients, [key]: value === '' ? null : value } }))} />)}
        <Group justify="space-between">
          <Button size="sm" color="red" variant="subtle" disabled={busy} onClick={() => {
            if (window.confirm(`Remove ${draft.name} from saved foods? Logged entries stay unchanged.`)) run(() => DaylightAPI(`api/v1/health/nutrition/catalog/${draft.id}`, {}, 'DELETE'));
          }}>Remove food</Button>
          <Button size="sm" variant="subtle" disabled={busy} onClick={() => setDraft(null)}>Back</Button>
          <Button size="sm" loading={busy} disabled={!draft.name.trim() || !(draft.grams > 0)} onClick={() => run(() => DaylightAPI(`api/v1/health/nutrition/catalog/${draft.id}`,
            { name: draft.name, grams: draft.grams, nutrients: draft.nutrients }, 'PUT'))}>Save definition</Button>
        </Group>
      </> : <>
        <TextInput label="Find a saved food" value={query} onChange={event => setQuery(event.target.value)} data-autofocus />
        {foods.loading ? <LoadingState label="Saved foods" /> : null}
        {foods.error ? <ErrorState error={foods.error} onRetry={foods.reload} label="Saved foods" /> : null}
        {(foods.data?.items || []).filter(food => food.type !== 'template').map(food => <UnstyledButton key={food.id} onClick={() => setDraft(structuredClone(food))}>
          <Group wrap="nowrap" gap="xs"><FoodIcon icon={food.icon} /><Text size="sm">{food.name}</Text><Text size="xs" c="dimmed">{food.grams > 0 ? `${Math.round(food.grams)} g` : 'Weight unknown'}</Text></Group>
        </UnstyledButton>)}
      </>}
    </Stack>
  </Sheet>;
}
