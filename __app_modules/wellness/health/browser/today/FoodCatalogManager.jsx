import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Group, NumberInput, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { Sheet, ErrorState, EmptyState, LoadingState, useRetryRegion } from '@/lib/ui';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { unavailableError } from "../healthResources.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { NUTRIENT_KEYS } from "../../portable/contracts/health/foodQuantity.mjs";
import { FoodIcon } from "./FoodIcon.jsx";

const logger = createAppLogger('health').child('food-manager');
export function FoodCatalogManager({ open, ...props }) {
  return open ? <Manager {...props} /> : null;
}
function Manager({ active = true, onClose, onChanged }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  const primaryInput = useRef(null);
  const editing = draft !== null;
  const wasEditing = useRef(editing);
  const visibleFoods = (foods.data?.items || []).filter(food => food.type !== 'template');
  const foodsUnavailable = unavailableError(foods);
  useLayoutEffect(() => {
    // The sheet owns initial focus. Its list and editor can change in place.
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    primaryInput.current?.focus();
  }, [editing]);
  const foods = useApiResource(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(query)}&limit=40`, { enabled: active, logger, swr: true });
  const { regionProps: resultsRegion, retry: retryFoods } = useRetryRegion(foods.reload, foods.loading || foods.revalidating);
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
        <TextInput ref={primaryInput} label="Food name" value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} disabled={busy} data-autofocus />
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
        <TextInput ref={primaryInput} label="Find a saved food" value={query} onChange={event => setQuery(event.target.value)} data-autofocus />
        <Stack component="section" {...resultsRegion} gap="xs" aria-label="Saved food results">
          {foods.loading ? <LoadingState label="Saved foods" /> : null}
          {foodsUnavailable ? <ErrorState error={foods.error} onRetry={retryFoods} label="Saved foods" /> : null}
          {!foods.loading && foods.data && !foodsUnavailable && visibleFoods.length === 0 ? (
            <EmptyState title={query.trim() ? 'No saved foods match your search' : 'No saved foods yet'} />
          ) : null}
          {visibleFoods.map(food => <UnstyledButton key={food.id} onClick={() => setDraft(structuredClone(food))}>
            <Group wrap="nowrap" gap="xs"><FoodIcon icon={food.icon} /><Text size="sm">{food.name}</Text><Text size="xs" c="dimmed">{food.grams > 0 ? `${Math.round(food.grams)} g` : 'Weight unknown'}</Text></Group>
          </UnstyledButton>)}
        </Stack>
      </>}
    </Stack>
  </Sheet>;
}
