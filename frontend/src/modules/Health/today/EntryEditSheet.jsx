import { useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('entry-edit');
const FACTORS = [0.25, 0.33, 0.5, 0.75, 1.5, 2, 3, 4];
const scale = (row, f) => ({
  amount: Math.round((Number(row.amount) || 1) * f * 100) / 100,
  calories: Math.round((Number(row.calories) || 0) * f),
  protein: Math.round((Number(row.protein) || 0) * f),
  carbs: Math.round((Number(row.carbs) || 0) * f),
  fat: Math.round((Number(row.fat) || 0) * f),
});

export function EntryEditSheet({ row, open, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState(null);
  if (!row) return null;

  const run = async (fn, event) => {
    setBusy(true); setError(null);
    try {
      await fn();
      logger.info(event, { uuid: row.uuid });
      onChanged();
      onClose();
    } catch (err) {
      logger.error(`${event}.failed`, { uuid: row.uuid, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={row.name || row.item}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{Math.round(row.calories || 0)} kcal · P {row.protein}g · C {row.carbs}g · F {row.fat}g</Text>
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}

        <Text size="xs" fw={600} tt="uppercase">Portion</Text>
        <Group gap="xs">
          {FACTORS.map((f) => (
            <Button key={f} size="xs" variant="light" disabled={busy}
              onClick={() => run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, scale(row, f), 'PUT'), 'portion')}>
              ×{f === 0.25 ? '¼' : f === 0.33 ? '⅓' : f === 0.5 ? '½' : f === 0.75 ? '¾' : f}
            </Button>
          ))}
        </Group>

        <Text size="xs" fw={600} tt="uppercase">Move to</Text>
        <Group gap="xs">
          {BUCKETS.map((b) => (
            <Button key={b.id} size="xs" disabled={busy}
              variant={row.mealTime === b.id ? 'filled' : 'light'}
              onClick={() => run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { mealTime: b.id }, 'PUT'), 'move')}>
              {b.label}
            </Button>
          ))}
        </Group>

        <Group gap="xs" mt="xs">
          <Button size="xs" variant="light" disabled={busy || starred} aria-label="favorite"
            onClick={async () => {
              try {
                await DaylightAPI('api/v1/health/nutrition/catalog/favorite',
                  { name: row.name || row.item, favorite: true }, 'PUT');
                setStarred(true);
                logger.info('favorite', { name: row.name });
              } catch (err) {
                logger.warn('favorite.failed', { name: row.name, error: err?.message });
                setError(err);
              }
            }}>
            {starred ? '★ Favorited' : '☆ Favorite'}
          </Button>
          <Button size="xs" variant="light" disabled={busy}
            onClick={() => run(() => DaylightAPI('api/v1/health/nutrition/meals', {
              name: row.name || row.item,
              items: [{ name: row.name || row.item, calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, color: row.color }],
            }, 'POST'), 'save-as-meal')}>
            Save as meal
          </Button>
          <Button size="xs" color="red" variant="subtle" disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete ${row.name || row.item}?`)) return;
              run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, {}, 'DELETE'), 'delete');
            }}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Sheet>
  );
}
export default EntryEditSheet;
