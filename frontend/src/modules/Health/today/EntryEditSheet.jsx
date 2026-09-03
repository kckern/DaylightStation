import { useEffect, useState } from 'react';
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';
import { nutritionPhotoUrl } from './photoUrl.js';

const logger = createAppLogger('health').child('entry-edit');
const FACTORS = [0.25, 0.33, 0.5, 0.75, 1.5, 2, 3, 4];
// A group row carries zero nutrition by design — scaling it does nothing.
// Scaling a GROUP means scaling every child, so this is a smaller, coarser
// set (no ¼/⅓/×3/×4) matched to "make the whole dish bigger/smaller".
const GROUP_FACTORS = [0.5, 0.75, 1.5, 2];
const factorLabel = (f) => (f === 0.25 ? '×¼' : f === 0.33 ? '×⅓' : f === 0.5 ? '×½' : f === 0.75 ? '×¾' : f === 1.5 ? '×1½' : `×${f}`);
const scale = (row, f) => ({
  amount: Math.round((Number(row.amount) || 1) * f * 100) / 100,
  calories: Math.round((Number(row.calories) || 0) * f),
  protein: Math.round((Number(row.protein) || 0) * f),
  carbs: Math.round((Number(row.carbs) || 0) * f),
  fat: Math.round((Number(row.fat) || 0) * f),
});
const displayName = (row) => row?.name || row?.item || row?.label || '';

export function EntryEditSheet({ row, open, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState(displayName(row));

  // Keep the rename field in sync whenever a DIFFERENT row is opened — this
  // component instance persists across opens (TodayView holds it mounted),
  // so without this the input would keep showing the previous row's name.
  useEffect(() => {
    if (row) setName(displayName(row));
  }, [row?.uuid]);

  if (!row) return null;

  const isGroup = row.kind === 'group';
  const children = Array.isArray(row.children) ? row.children : [];

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

  // Fires N independent calls (one per id) SEQUENTIALLY, never aborting the
  // remaining ones just because an earlier one failed — a network blip on
  // child 2 of 5 must not leave children 3-5 untouched. The day is ALWAYS
  // reloaded afterward so the UI reflects the real, possibly-partial,
  // result; the sheet only auto-closes on a clean sweep — on a partial
  // failure it stays open with an error naming how many calls failed, so
  // the user is never left believing a group is fully gone/scaled when
  // it isn't.
  const runBatch = async (ids, fn, event) => {
    setBusy(true); setError(null);
    const failures = [];
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fn(id);
      } catch (err) {
        failures.push({ id, error: err });
      }
    }
    setBusy(false);
    onChanged();
    if (failures.length) {
      logger.error(`${event}.partial_failure`, {
        uuid: row.uuid, failed: failures.length, total: ids.length,
      });
      setError(new Error(`${failures.length} of ${ids.length} updates failed — the list has been reloaded to show what actually happened.`));
      return;
    }
    logger.info(event, { uuid: row.uuid, count: ids.length });
    onClose();
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { name: trimmed }, 'PUT'), 'rename');
  };

  const scaleGroup = (f) => {
    runBatch(
      children.map((c) => c.uuid),
      (id) => {
        const child = children.find((c) => c.uuid === id);
        return DaylightAPI(`api/v1/health/nutrilist/${id}`, scale(child, f), 'PUT');
      },
      'group-scale',
    );
  };

  const deleteGroup = () => {
    const n = children.length;
    const label = displayName(row) || 'this group';
    const msg = n > 0 ? `Delete ${label} and its ${n} item${n === 1 ? '' : 's'}?` : `Delete ${label}?`;
    if (!window.confirm(msg)) return;
    const ids = [...children.map((c) => c.uuid), row.uuid];
    runBatch(ids, (id) => DaylightAPI(`api/v1/health/nutrilist/${id}`, {}, 'DELETE'), 'group-delete');
  };

  return (
    <Sheet open={open} onClose={onClose} title={displayName(row)}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{Math.round(row.calories || 0)} kcal · P {row.protein}g · C {row.carbs}g · F {row.fat}g</Text>
        {row.photoRef ? (
          <img
            className="health-edit__photo"
            src={nutritionPhotoUrl(row.photoRef)}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : null}
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}

        {isGroup ? (
          <>
            <Text size="xs" fw={600} tt="uppercase">Rename</Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput className="health-edit__control" aria-label="Group name" value={name} disabled={busy}
                onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button className="health-edit__control" size="xs" disabled={busy || !name.trim()} onClick={saveName}>Save</Button>
            </Group>
          </>
        ) : null}

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

        <Text size="xs" fw={600} tt="uppercase">{isGroup ? 'Scale whole group' : 'Portion'}</Text>
        <Group gap="xs">
          {isGroup ? (
            GROUP_FACTORS.map((f) => (
              <Button key={f} className="health-edit__control" size="xs" variant="light" disabled={busy || children.length === 0}
                onClick={() => scaleGroup(f)}>
                {factorLabel(f)}
              </Button>
            ))
          ) : (
            FACTORS.map((f) => (
              <Button key={f} size="xs" variant="light" disabled={busy}
                onClick={() => run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, scale(row, f), 'PUT'), 'portion')}>
                {factorLabel(f)}
              </Button>
            ))
          )}
        </Group>

        <Group gap="xs" mt="xs">
          {!isGroup ? (
            <>
              <Button size="xs" variant="light" disabled={busy || starred} aria-label="favorite"
                onClick={async () => {
                  try {
                    await DaylightAPI('api/v1/health/nutrition/catalog/favorite',
                      { name: displayName(row), favorite: true }, 'PUT');
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
                  name: displayName(row),
                  items: [{ name: displayName(row), calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, color: row.color }],
                }, 'POST'), 'save-as-meal')}>
                Save as meal
              </Button>
            </>
          ) : null}
          <Button size="xs" color="red" variant="subtle" disabled={busy}
            onClick={() => {
              if (isGroup) { deleteGroup(); return; }
              if (!window.confirm(`Delete ${displayName(row)}?`)) return;
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
