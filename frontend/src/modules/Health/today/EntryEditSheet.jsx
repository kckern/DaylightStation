import { useEffect, useState } from 'react';
import { Button, Group, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';
import { nutritionPhotoUrl } from './photoUrl.js';
import { nutritionIconUrl, NEUTRAL_ICON } from './iconUrl.js';
import { ObservationRow } from './ObservationRow.jsx';

const logger = createAppLogger('health').child('entry-edit');
const FACTORS = [0.25, 0.33, 0.5, 0.75, 1.5, 2, 3, 4];
// A group row carries zero nutrition by design — scaling it does nothing.
// Scaling a GROUP means scaling every child, so this is a smaller, coarser
// set (no ¼/⅓/×3/×4) matched to "make the whole dish bigger/smaller".
const GROUP_FACTORS = [0.5, 0.75, 1.5, 2];
const factorLabel = (f) => (f === 0.25 ? '×¼' : f === 0.33 ? '×⅓' : f === 0.5 ? '×½' : f === 0.75 ? '×¾' : f === 1.5 ? '×1½' : `×${f}`);
const scale = (row, f) => ({
  amount: Math.round((Number(row.amount) || 1) * f * 100) / 100,
  ...(Number.isFinite(Number(row.grams)) && Number(row.grams) > 0
    ? { grams: Math.round(Number(row.grams) * f * 10) / 10 }
    : {}),
  calories: Math.round((Number(row.calories) || 0) * f),
  protein: Math.round((Number(row.protein) || 0) * f),
  carbs: Math.round((Number(row.carbs) || 0) * f),
  fat: Math.round((Number(row.fat) || 0) * f),
});
const displayName = (row) => row?.name || row?.item || row?.label || '';

/**
 * The server's own sentence out of a DaylightAPI error, whose message is
 * `HTTP <status>: <statusText> - <raw body>`. Returns null when there is no JSON body
 * with an `error` field, so the caller falls back to the original message.
 */
function serverMessage(err) {
  const raw = typeof err?.message === 'string' ? err.message : '';
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const body = JSON.parse(raw.slice(start));
    return typeof body?.error === 'string' && body.error ? body.error : null;
  } catch { return null; }
}

export function EntryEditSheet({ row, open, onClose, onChanged, observations = [], onPaired }) {
  const [busy, setBusy] = useState(false);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState(displayName(row));
  const [pairingId, setPairingId] = useState(null);
  // Icon override (PRD F5.4). `picking` opens the grid; `pendingIcon` is the
  // slug the user tapped but has not yet chosen a SCOPE for — "just this
  // entry" or "always for this food" — because the scope is the whole point
  // of the interaction and picking a picture must not silently imply one.
  const [picking, setPicking] = useState(false);
  const [iconQuery, setIconQuery] = useState('');
  const [iconOptions, setIconOptions] = useState([]);
  const [pendingIcon, setPendingIcon] = useState(null);

  // Keep the rename field in sync whenever a DIFFERENT row is opened — this
  // component instance persists across opens (TodayView holds it mounted),
  // so without this the input would keep showing the previous row's name.
  useEffect(() => {
    if (row) setName(displayName(row));
    // Same reason as the name field: this instance persists across opens, so
    // a half-finished icon change on the PREVIOUS row would otherwise still be
    // on screen — and could be applied to a different food.
    setPicking(false);
    setPendingIcon(null);
    setIconQuery('');
  }, [row?.uuid]);

  // The vocabulary comes from the manifest, never from a list in this file:
  // filenames (and which slugs exist at all) are the manifest's business.
  useEffect(() => {
    if (!picking) return undefined;
    let cancelled = false;
    DaylightAPI(`api/v1/health/nutrition/icons?q=${encodeURIComponent(iconQuery)}&limit=60`)
      .then((res) => { if (!cancelled) setIconOptions(Array.isArray(res?.icons) ? res.icons : []); })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('icons.list_failed', { error: err?.message });
        setIconOptions([]);
      });
    return () => { cancelled = true; };
  }, [picking, iconQuery]);

  if (!row) return null;

  // Gated on `row.kind === 'group'` — the SAME field the backend cascade
  // gates on (HealthOperations#cascadeMealTimeToChildren). LogTable.jsx
  // deliberately gates its OWN group presentation on "does this row have
  // resolved children" instead (its comment explains why: nothing upstream
  // guarantees only kind:'group' rows carry children). The two are
  // equivalent today only because every real write path stamps kind:'group'
  // on a row before ever giving it children (groupParsedItems.mjs) — a
  // future write path that sets `parentId` without `kind:'group'` would
  // silently fall through to ITEM mode here (no rename/scale-group/cascade),
  // reintroducing the orphaning failure this task exists to prevent. If you
  // change how one site decides "is this a group", change the other the
  // same way.
  const isGroup = row.kind === 'group';
  const children = Array.isArray(row.children) ? row.children : [];

  // A DISMISSED measurement is a signal the person has already judged not to matter.
  // Offering it an active "pair to this entry" button invites them to attach evidence
  // they explicitly threw away, so it is filtered out of this list entirely (it stays
  // readable in the ledger, and the day view still shows nothing for it).
  //
  // A GROUP row gets NO measurements list at all. Its own row holds zero nutrition by
  // design (the children carry it), so a measurement attached here would be counted twice
  // inside one dish — the backend refuses it (`ENTRY_IS_GROUP`), and a button that always
  // 409s is worse than no button. Gated on `row.kind === 'group'`, the same field this
  // sheet's group mode and the backend both use.
  const pairable = isGroup ? [] : observations.filter((o) => o.status !== 'dismissed');

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

  // "Move to" gets its own handler (rather than reusing `run`) because a
  // GROUP move needs to inspect the response: the backend cascades a
  // mealTime change to every child server-side (HealthOperations), but that
  // cascade silently no-ops if the group row is missing a `date` (see
  // report's Concerns section) — `cascadedIds` exists specifically so this
  // can be caught instead of the sheet closing on a lie ("moved!" when the
  // children stayed behind). Item-mode moves are unaffected: the warning
  // check is gated on `isGroup && children.length > 0`, so a plain item's
  // response (no `cascadedIds` at all) never trips it.
  const moveTo = async (bucketId) => {
    setBusy(true); setError(null);
    try {
      const result = await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { mealTime: bucketId }, 'PUT');
      onChanged();
      if (isGroup && children.length > 0 && !(result?.cascadedIds?.length)) {
        logger.warn('move.cascade_missing', { uuid: row.uuid, childCount: children.length });
        setError(new Error(`${displayName(row)} moved, but its ${children.length} item${children.length === 1 ? '' : 's'} did not move with it — check them manually.`));
        return;
      }
      logger.info('move', { uuid: row.uuid, bucketId });
      onClose();
    } catch (err) {
      logger.error('move.failed', { uuid: row.uuid, error: err?.message });
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

  // Attach one of the day's scale measurements to THIS entry. The backend does the
  // recompute (grams from the measurement's own net weight; calories too when a density
  // scan is part of the evidence) and releases whatever the measurement pointed at
  // before, so this handler only has to report the outcome.
  //
  // A refusal is surfaced, never swallowed: the ledger stores a bounded hot file plus
  // monthly archives and cannot rewrite two of them atomically, so a re-pair that would
  // span them is rejected with nothing written (409). Showing that is the difference
  // between "I could not do it" and a half-applied change nobody can see.
  const pairObservation = async (observation) => {
    setPairingId(observation.id);
    setError(null);
    try {
      await DaylightAPI(`api/v1/health/nutrition/observations/${observation.id}/pair`,
        { entryUuid: row.uuid }, 'POST');
      logger.info('measurement.paired', { uuid: row.uuid, observationId: observation.id });
      onPaired?.(null);
      onChanged();
      onClose();
    } catch (err) {
      logger.error('measurement.pair_failed', { uuid: row.uuid, observationId: observation.id, error: err?.message });
      // DaylightAPI wraps a non-2xx as `HTTP 409: Conflict - {json body}`. The body's
      // `error` is a sentence written for this exact situation ("… would leave that entry
      // counting the same food a second time. Delete or correct … first"); showing the
      // raw wrapper instead would bury it behind a status line.
      const shown = new Error(serverMessage(err) || err?.message || 'Could not attach this measurement.');
      setError(shown);
      onPaired?.(shown);
    } finally { setPairingId(null); }
  };

  // "Just this entry" (PRD F5.4): only the row changes. The catalog keeps
  // whatever it had, so the next log of this food is unaffected.
  const applyIconToEntry = (icon) => run(
    () => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { icon }, 'PUT'),
    'icon.entry',
  );

  // "Always for this food": the catalog entry is pinned AND this row is
  // corrected. The row update is not redundant — a row's icon is a COPY taken
  // at log time, so pinning the catalog alone would leave the row the user is
  // looking at unchanged, and the change would read as having failed. Past
  // rows are likewise not rewritten; they keep the picture they were logged
  // with, and new logs of this food get the pinned one.
  const applyIconAlways = (icon) => run(async () => {
    await DaylightAPI('api/v1/health/nutrition/catalog/icon',
      { name: displayName(row), icon }, 'PUT');
    await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { icon }, 'PUT');
  }, 'icon.always');

  const currentIcon = row.icon && row.icon !== NEUTRAL_ICON ? row.icon : null;

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

  // Deliberately NOT `runBatch` — group delete has an ordering requirement
  // runBatch's flat "fire every id, report failures" shape can't express:
  // the group row's OWN delete must never be attempted while any child
  // delete failed. Attempting it anyway (the original bug) deletes the
  // dish while stranding the surviving child as a top-level row — the user
  // asked to remove a dish and got a vanished dish plus an orphaned
  // ingredient, with no message even hinting at it. Children still get the
  // same "attempt all of them, don't stop at the first failure" treatment
  // as before; only the FINAL step (the group itself) is now conditional.
  const deleteGroup = async () => {
    const n = children.length;
    const label = displayName(row) || 'this group';
    const msg = n > 0 ? `Delete ${label} and its ${n} item${n === 1 ? '' : 's'}?` : `Delete ${label}?`;
    if (!window.confirm(msg)) return;

    setBusy(true); setError(null);
    const childIds = children.map((c) => c.uuid);
    const childFailures = [];
    for (const id of childIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await DaylightAPI(`api/v1/health/nutrilist/${id}`, {}, 'DELETE');
      } catch (err) {
        childFailures.push({ id, error: err });
      }
    }

    let groupFailed = false;
    if (childFailures.length === 0) {
      // Safe to remove the group ONLY when every child is confirmed gone —
      // never delete the parent out from under a surviving child.
      try {
        await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, {}, 'DELETE');
      } catch (err) {
        groupFailed = true;
        logger.error('group-delete.group_failed', { uuid: row.uuid, error: err?.message });
      }
    }

    setBusy(false);
    onChanged();

    if (childFailures.length > 0) {
      logger.error('group-delete.partial_failure', {
        uuid: row.uuid, failed: childFailures.length, total: childIds.length,
      });
      setError(new Error(`${childFailures.length} of ${childIds.length} items could not be deleted — ${label} was NOT deleted and still has its remaining items. The list has been reloaded to show what's actually there.`));
      return;
    }
    if (groupFailed) {
      setError(new Error(`${label}'s items were removed, but ${label} itself could not be deleted — try again.`));
      return;
    }
    logger.info('group-delete', { uuid: row.uuid, count: childIds.length + 1 });
    onClose();
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

        {pairable.length > 0 ? (
          <>
            <Text size="xs" fw={600} tt="uppercase">Measurements</Text>
            <div className="health-obs health-obs--sheet">
              {pairable.map((o) => {
                const attached = o.status === 'consumed' && o.pairedEntryUuid === row.uuid;
                // Consumed by a DIFFERENT entry: the backend would refuse this
                // (PRIOR_ENTRY_EXISTS — that entry's numbers were calculated from it), so
                // say so up front instead of offering a button that only ever 409s.
                const elsewhere = o.status === 'consumed' && o.pairedEntryUuid && !attached;
                return (
                  <ObservationRow key={o.id} observation={o}
                    onPair={pairObservation}
                    pairing={pairingId === o.id}
                    attached={attached}
                    blocked={elsewhere ? 'Another entry was calculated from this — correct that entry first' : null} />
                );
              })}
            </div>
          </>
        ) : null}

        <Text size="xs" fw={600} tt="uppercase">Icon</Text>
        <Group gap="xs" wrap="nowrap">
          {currentIcon ? (
            <img className="health-row__icon health-row__icon--picker" src={nutritionIconUrl(currentIcon)}
              alt={`Current icon: ${currentIcon}`} />
          ) : (
            <Text size="sm" c="dimmed">No icon</Text>
          )}
          <Button size="xs" variant="light" disabled={busy}
            onClick={() => { setPicking((open) => !open); setPendingIcon(null); }}>
            {picking ? 'Cancel' : 'Change…'}
          </Button>
          {currentIcon && !picking ? (
            <Button size="xs" variant="subtle" disabled={busy} onClick={() => applyIconToEntry(null)}>
              Remove
            </Button>
          ) : null}
        </Group>

        {picking ? (
          <>
            <TextInput className="health-edit__control" aria-label="Search icons" placeholder="Search icons"
              value={iconQuery} disabled={busy} onChange={(e) => setIconQuery(e.currentTarget.value)} />
            {/* A grid of tap targets, never a dropdown: this is a touch
                surface and the pictures ARE the labels. Each carries its slug
                as its accessible name, so the grid is navigable without
                seeing the images at all. */}
            <div className="health-icon-grid">
              {iconOptions.map((slug) => (
                <UnstyledButton key={slug} className="health-icon-grid__cell" aria-label={slug}
                  aria-pressed={pendingIcon === slug} onClick={() => setPendingIcon(slug)}>
                  <img className="health-row__icon health-row__icon--picker" src={nutritionIconUrl(slug)} alt="" loading="lazy" />
                </UnstyledButton>
              ))}
              {iconOptions.length === 0 ? <Text size="sm" c="dimmed">No icons match.</Text> : null}
            </div>
            {/* The scope question. Asked AFTER a picture is chosen and never
                assumed — "always" edits a food the user may log for years. */}
            {pendingIcon ? (
              <Group gap="xs">
                <Button size="xs" disabled={busy} onClick={() => applyIconToEntry(pendingIcon)}>
                  Just this entry
                </Button>
                {!isGroup ? (
                  <Button size="xs" variant="light" disabled={busy} onClick={() => applyIconAlways(pendingIcon)}>
                    Always for this food
                  </Button>
                ) : null}
              </Group>
            ) : null}
          </>
        ) : null}

        <Text size="xs" fw={600} tt="uppercase">Move to</Text>
        <Group gap="xs">
          {BUCKETS.map((b) => (
            <Button key={b.id} size="xs" disabled={busy}
              variant={row.mealTime === b.id ? 'filled' : 'light'}
              onClick={() => moveTo(b.id)}>
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
              {/* A one-item TEMPLATE, not a saved meal: the template picker is
                  the only surface that lists kept meals (PRD F6.3), so a meal
                  saved here into the meals store would be invisible. */}
              <Button size="xs" variant="light" disabled={busy}
                onClick={() => run(() => DaylightAPI('api/v1/health/nutrition/templates', {
                  name: displayName(row),
                  components: [{
                    name: displayName(row), role: 'core',
                    calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat,
                    // Micros + provenance travel with the snapshot (PRD F4.x):
                    // a template must not be a downgrade of the row it came from.
                    fiber: row.fiber, sugar: row.sugar, sodium: row.sodium, cholesterol: row.cholesterol,
                    microsSource: row.microsSource ?? null,
                    color: row.color, icon: row.icon ?? null, grams: row.grams, unit: row.unit, amount: row.amount,
                  }],
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
