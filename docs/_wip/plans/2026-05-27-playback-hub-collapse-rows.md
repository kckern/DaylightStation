# Playback Hub Collapse-Row Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `SchedulesSection` and `ScheduledFiresSection` (inside the playback-hub admin `DeviceCard`) render each entry as a compact one-line summary by default, expanding to the existing form on click — so the panels stay scannable when a slot has multiple windows or fires.

**Architecture:**
- Pure presentational change inside two existing components and one tiny new hook. Wire shapes, mutations, REST endpoints, and the YAML datastore are all untouched.
- Each section keeps a local `Set<key>` of expanded row keys. Rows get a stable client-side `_key` on hydration; new rows auto-expand; rows with un-saved (dirty) edits stay expanded.
- Summary rows reuse the existing title-cache by way of a new shared hook `useContentTitle(contentId)` extracted from `LabeledContentPicker.jsx` so we don't refetch.

**Tech Stack:**
- React 18, Mantine v7 (`Card`, `Group`, `Stack`, `ActionIcon`, `Text`, `Chip`), `@tabler/icons-react`
- vitest + `@testing-library/react`, config at `vitest.config.mjs` (root)

**Commit policy:**
- Project rule says "do not commit automatically — user reviews first". For each task, the executing agent should **stage** the listed files and **pause for user review** (e.g. show `git diff --staged`) before running the commit command. The user can say "auto-commit OK" to streamline.
- One commit per task. Conventional Commits style — these are `refactor:` or `feat(playback-hub):`.

**How to run a single test file:**
```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx --reporter=verbose
```
All vitest paths are relative to the repo root.

**Out of scope (explicitly):**
- Adding fire thumbnails / queue donut visualizations / `SAVE ALL` flows from the mockup.
- HA entity Combobox, Volume Limits inline gauge, left-edge color stripe on `DeviceCard`, elevated `now_playing` in `DeviceHeader` — those are tracked separately and can land in independent PRs.

---

## Phase 0 — Extract `useContentTitle` hook

**Why first:** Summary rows need to render the queue's resolved human title (e.g. `Lo-fi Beats`) next to the time. Today that resolution only happens inside `LabeledContentPicker.jsx:30-54`. Extracting it into a reusable hook means the summary rows can use the **same shared `titleCache`** as the pickers — no duplicate fetches, no flicker.

### Task 0.1: Create the hook with a failing test

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.js`
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx`

**Step 1: Write the failing test**

```jsx
// frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContentTitle } from './useContentTitle.js';
import { titleCache } from '../utils/titleCache.js';

describe('useContentTitle', () => {
  beforeEach(() => {
    titleCache.clear();
    vi.restoreAllMocks();
  });

  it('returns null for empty contentId without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useContentTitle(''));
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns cached title synchronously when present', () => {
    titleCache.set('plex:42', 'Cached Title');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useContentTitle('plex:42'));
    expect(result.current).toBe('Cached Title');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and primes cache on first miss', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Fetched Title' }),
    });
    const { result } = renderHook(() => useContentTitle('plex:99'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('Fetched Title'));
    expect(titleCache.get('plex:99')).toBe('Fetched Title');
  });

  it('fails soft (returns null) on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useContentTitle('plex:404'));
    await waitFor(() => {}, { timeout: 50 });
    expect(result.current).toBeNull();
  });
});
```

**Step 2: Run the test — expect FAIL**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx --reporter=verbose
```
Expected: `Cannot find module './useContentTitle.js'`.

**Step 3: Implement the hook**

```javascript
// frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.js
import { useEffect, useState } from 'react';
import { titleCache } from '../utils/titleCache.js';

/**
 * Resolve the human-readable title of a "source:id" content ID, sharing the
 * module-level `titleCache` with LabeledContentPicker so summary rows and
 * pickers never refetch the same id. Fail-soft: returns null on any error.
 */
export function useContentTitle(contentId) {
  const [title, setTitle] = useState(
    () => (contentId ? titleCache.get(contentId) || null : null)
  );

  useEffect(() => {
    if (!contentId) {
      setTitle(null);
      return;
    }
    const cached = titleCache.get(contentId);
    if (cached) {
      setTitle(cached);
      return;
    }
    const [source, id] = contentId.split(':');
    if (!source || !id) return;
    let cancelled = false;
    fetch(`/api/v1/info/${encodeURIComponent(source)}/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const t = data?.title ?? null;
        if (t) titleCache.set(contentId, t);
        setTitle(t);
      })
      .catch(() => { /* fail-soft */ });
    return () => { cancelled = true; };
  }, [contentId]);

  return title;
}

export default useContentTitle;
```

**Step 4: Run the test — expect PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx --reporter=verbose
```

**Step 5: Stage + pause for review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.js \
        frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx
git diff --staged   # pause for user review
git commit -m "feat(playback-hub): extract useContentTitle hook for summary rendering"
```

---

### Task 0.2: Refactor `LabeledContentPicker` to use the new hook

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx:26-77`
- Test: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.test.jsx` (already exists — must still pass)

**Step 1: Run the existing picker tests to capture baseline**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.test.jsx --reporter=verbose
```
Expected: PASS. Note pass count.

**Step 2: Refactor the picker — same behavior, hook-backed**

Replace the body of `LabeledContentPicker` so the mount/value-change fetch is delegated to `useContentTitle`, while the dropdown-pick path still primes the cache + local override (the no-flicker pattern documented in `LabeledContentPicker.jsx:11-20`). Important: the **local override** must take precedence over the hook's value when set, because dropdown picks need to update the label before the next mount-effect cycle runs.

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx
import React, { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import ContentSearchCombobox from '../../ContentLists/ContentSearchCombobox';
import { titleCache } from '../utils/titleCache.js';
import { useContentTitle } from '../hooks/useContentTitle.js';

export function LabeledContentPicker({ value, onChange, placeholder, ...rest }) {
  // Local override for dropdown picks (no-flicker path). Cleared on freeform
  // commit so the hook re-resolves via /api/v1/info/:source/:id.
  const [localTitle, setLocalTitle] = useState(null);
  const resolvedTitle = useContentTitle(value);
  const title = localTitle ?? resolvedTitle;

  return (
    <Stack gap={4}>
      {title && <Text size="sm" c="dimmed">{title}</Text>}
      <ContentSearchCombobox
        value={value}
        placeholder={placeholder}
        onChange={(id, item) => {
          if (item?.title) {
            titleCache.set(id, item.title);
            setLocalTitle(item.title);
          } else {
            setLocalTitle(null);
          }
          onChange(id, item);
        }}
        {...rest}
      />
    </Stack>
  );
}

export default LabeledContentPicker;
```

**Step 3: Re-run picker tests + the new hook tests — expect PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.test.jsx \
              frontend/src/modules/Admin/PlaybackHub/hooks/useContentTitle.test.jsx \
              --reporter=verbose
```
Expected: all green, same count as baseline + new hook tests.

**Step 4: Stage + review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx
git diff --staged
git commit -m "refactor(playback-hub): LabeledContentPicker uses useContentTitle hook"
```

---

## Phase 1 — `SchedulesSection` collapse-row

### Task 1.1: Add `ScheduleWindowSummary` subcomponent

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.test.jsx`

The summary renders one line: `start – end · <queue title> · shuffle` (the `shuffle` segment is conditional). Times that are blank render as `—`. Title falls back to the raw content id when unresolved.

**Step 1: Write the failing test**

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ScheduleWindowSummary } from './ScheduleWindowSummary.jsx';

vi.mock('../hooks/useContentTitle.js', () => ({
  useContentTitle: (id) => (id === 'plex:1' ? 'Lo-fi Beats' : null),
}));

function rsum(window) {
  return render(
    <MantineProvider>
      <ScheduleWindowSummary window={window} />
    </MantineProvider>
  );
}

describe('ScheduleWindowSummary', () => {
  it('renders start, end, resolved title, and shuffle marker', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:1', shuffle: true });
    expect(screen.getByText('07:00 – 21:00')).toBeInTheDocument();
    expect(screen.getByText('Lo-fi Beats')).toBeInTheDocument();
    expect(screen.getByText(/shuffle/i)).toBeInTheDocument();
  });

  it('omits shuffle marker when shuffle is false', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:1', shuffle: false });
    expect(screen.queryByText(/shuffle/i)).toBeNull();
  });

  it('falls back to raw id when title is unresolved', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:unknown', shuffle: false });
    expect(screen.getByText('plex:unknown')).toBeInTheDocument();
  });

  it('renders em-dash when start or end is blank', () => {
    rsum({ start: '', end: '', queue: 'plex:1', shuffle: false });
    expect(screen.getByText('— – —')).toBeInTheDocument();
  });
});
```

**Step 2: Run — expect FAIL** (module missing).

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.test.jsx --reporter=verbose
```

**Step 3: Implement**

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.jsx
import React from 'react';
import { Group, Text } from '@mantine/core';
import { useContentTitle } from '../hooks/useContentTitle.js';

const DASH = '—';

export function ScheduleWindowSummary({ window }) {
  const title = useContentTitle(window?.queue || '');
  const display = title || window?.queue || '(no queue)';
  const start = window?.start || DASH;
  const end = window?.end || DASH;

  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" ff="monospace">{`${start} – ${end}`}</Text>
      <Text size="sm" c="dimmed">·</Text>
      <Text size="sm" truncate>{display}</Text>
      {window?.shuffle && (
        <>
          <Text size="sm" c="dimmed">·</Text>
          <Text size="xs" c="blue.5">shuffle</Text>
        </>
      )}
    </Group>
  );
}

export default ScheduleWindowSummary;
```

**Step 4: Run — expect PASS.**

**Step 5: Stage + review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.jsx \
        frontend/src/modules/Admin/PlaybackHub/components/ScheduleWindowSummary.test.jsx
git diff --staged
git commit -m "feat(playback-hub): add ScheduleWindowSummary subcomponent"
```

---

### Task 1.2: Add collapse-row behavior to `SchedulesSection` — existing rows collapsed by default

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.jsx`

**Behavior spec:**
- Each window gets a stable client-side `_key` at hydration (so identity survives reorders).
- **Existing rows** (those originally from `slot.schedules`) start **collapsed**.
- **Newly-added rows** (via "Add window") start **expanded** — you can't fill in a hidden form.
- **Dirty rows** (any field differs from the baseline window from `slot.schedules`) stay expanded even after a manual collapse attempt.
- Collapsed row renders `<ScheduleWindowSummary>` + a chevron `ActionIcon` (`IconChevronDown`) + the existing trash `ActionIcon`. Clicking anywhere on the summary toggles expansion.
- Expanded row renders the existing form **plus** a chevron-up `ActionIcon` to collapse.

**Step 1: Add a failing test for default collapsed state**

Add to `SchedulesSection.test.jsx`:

```jsx
it('renders existing windows as collapsed (summary visible, form hidden)', () => {
  renderSection({ slot: mkSlot(), mutations });
  // Summary row is visible
  expect(screen.getByText('07:00 – 21:00')).toBeInTheDocument();
  // Form inputs are NOT yet rendered
  expect(screen.queryByLabelText(/start/i)).toBeNull();
  expect(screen.queryByLabelText(/end/i)).toBeNull();
});

it('clicking expand chevron reveals the form', () => {
  renderSection({ slot: mkSlot(), mutations });
  fireEvent.click(screen.getByRole('button', { name: /expand window 1/i }));
  expect(screen.getByLabelText(/start/i)).toHaveValue('07:00');
  expect(screen.getByLabelText(/end/i)).toHaveValue('21:00');
});

it('newly added rows start expanded', () => {
  renderSection({ slot: mkSlot({ schedules: [] }), mutations });
  fireEvent.click(screen.getByRole('button', { name: /add window/i }));
  expect(screen.getByLabelText(/start/i)).toBeInTheDocument();
});
```

**Step 2: Run — expect FAIL** (no summary, no chevron, existing form is always rendered).

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx --reporter=verbose
```

**Step 3: Implement the collapse-row machinery**

Edit `SchedulesSection.jsx`:

1. Import `ScheduleWindowSummary` and `IconChevronDown`, `IconChevronUp` from `@tabler/icons-react`.
2. Replace the `windows` state with a `rows` state whose elements are `{ _key, start, end, queue, shuffle }`. The `_key` is a `crypto.randomUUID()` (with the same `newKey()` fallback pattern used in `ScheduledFiresSection.jsx:24-29`).
3. Hydrate from `slot.schedules` in the existing `useEffect`, assigning `_key` per row.
4. Add `const [expandedKeys, setExpandedKeys] = useState(() => new Set())`. Existing rows are absent → collapsed by default.
5. On `addWindow`, push the new row's `_key` into `expandedKeys` so it auto-opens.
6. Compute `isDirty(row)` by comparing `{start,end,queue,shuffle}` against the matching window in `slot.schedules` (matched by `_key` via a parallel map kept in a ref, OR by re-hydrating baselines on `slot.schedules` change). Simplest: keep a `baselineByKey` ref that's rebuilt in the hydration effect.
7. Render: if `expandedKeys.has(row._key) || isDirty(row)` → form; else → summary + chevron.
8. `removeWindow` drops the `_key` from `expandedKeys`.
9. The summary row's chevron button must have `aria-label={`expand window ${idx + 1}`}` so the new test query matches. The expanded chevron uses `collapse window ${idx + 1}`.
10. **Save handler:** map the rows back to wire shape — strip `_key` before sending to `mutations.updateDevice`. After a successful save, rebaseline (already triggered by the slot-prop effect when the parent re-renders with the saved `schedules`).

Pseudocode skeleton (full implementation goes in the file):

```jsx
const baselineByKey = useRef(new Map());

useEffect(() => {
  const next = (slot?.schedules ?? []).map((w) => ({ _key: newKey(), ...w }));
  baselineByKey.current = new Map(
    next.map((w) => [w._key, { start: w.start || '', end: w.end || '', queue: w.queue || '', shuffle: !!w.shuffle }])
  );
  setRows(next);
  setExpandedKeys(new Set()); // collapse everything when slot changes
}, [slot?.schedules]);

function isRowDirty(row) {
  const b = baselineByKey.current.get(row._key);
  if (!b) return true; // new row, no baseline
  return b.start !== (row.start || '') ||
         b.end !== (row.end || '') ||
         b.queue !== (row.queue || '') ||
         b.shuffle !== !!row.shuffle;
}

const isExpanded = (row) => expandedKeys.has(row._key) || isRowDirty(row);

// In the render:
// {rows.map((row, idx) => (
//   <Paper key={row._key} withBorder p="sm">
//     {isExpanded(row) ? <ExistingFormFor row={row} /> : (
//       <Group justify="space-between" wrap="nowrap">
//         <Group onClick={() => toggleExpand(row._key)} style={{ cursor: 'pointer', flex: 1 }}>
//           <ScheduleWindowSummary window={row} />
//         </Group>
//         <ActionIcon onClick={() => toggleExpand(row._key)} aria-label={`expand window ${idx + 1}`}>
//           <IconChevronDown size={16} />
//         </ActionIcon>
//         <ActionIcon color="red" variant="subtle" onClick={() => removeWindow(idx)} aria-label={`remove window ${idx + 1}`}>
//           <IconTrash size={16} />
//         </ActionIcon>
//       </Group>
//     )}
//   </Paper>
// ))}
```

**Step 4: Run new tests — expect PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx --reporter=verbose
```

The three new tests should pass. **Existing tests will fail** — they assume the form inputs are always rendered. Fix them in the next step.

**Step 5: Update existing `SchedulesSection.test.jsx` tests to expand first**

The tests that need updating (in `SchedulesSection.test.jsx`):

| Test | Fix |
|------|-----|
| `renders existing windows with start/end/queue/shuffle` | Before reading inputs, click `expand window 1` |
| `Save calls updateDevice with the full updated continuous list` | Click `expand window 1` before editing the start input |
| `Shuffle switch toggles shuffle field in saved payload` | Click `expand window 1` before clicking the switch |

The "Add window" and "Remove" and empty-state tests should already pass without changes because they exercise the add path (auto-expanded) or the remove path (works on either state).

Add a tiny helper at the top of the test file to keep diffs small:

```jsx
function expandWindow(n = 1) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`expand window ${n}`, 'i') }));
}
```

**Step 6: Run all `SchedulesSection.test.jsx` — expect PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx --reporter=verbose
```

**Step 7: Add a regression test: editing a collapsed row re-expands and stays open**

This proves the dirty-tracking is wired up.

```jsx
it('expanding, editing, and collapsing keeps the row expanded while dirty', () => {
  renderSection({ slot: mkSlot(), mutations });
  fireEvent.click(screen.getByRole('button', { name: /expand window 1/i }));
  fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '08:00' } });

  // Attempt to collapse
  fireEvent.click(screen.getByRole('button', { name: /collapse window 1/i }));

  // Form should still be there — dirty wins
  expect(screen.getByLabelText(/start/i)).toHaveValue('08:00');
});
```

Run — expect PASS.

**Step 8: Stage + review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.jsx \
        frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx
git diff --staged
git commit -m "feat(playback-hub): collapse-row pattern for SchedulesSection"
```

---

## Phase 2 — `ScheduledFiresSection` collapse-row

Same pattern; the differences are: fires have an `id`, a different summary format, and a different existing test shape.

### Task 2.1: Add `ScheduledFireSummary` subcomponent

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.test.jsx`

Summary line format: `HH:MM · <days-chip> · <queue title>` — duration and volume override are edit-only details (kept off the summary to fit on one line; they're visible the moment you expand).

**Step 1: Write the failing test**

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ScheduledFireSummary } from './ScheduledFireSummary.jsx';

vi.mock('../hooks/useContentTitle.js', () => ({
  useContentTitle: (id) => (id === 'plex:1' ? 'Wake-up Playlist' : null),
}));

function rsum(row) {
  return render(
    <MantineProvider>
      <ScheduledFireSummary row={row} />
    </MantineProvider>
  );
}

describe('ScheduledFireSummary', () => {
  it('renders time, days chip, and resolved title', () => {
    rsum({ time: '07:30', days: 'weekdays', queue: 'plex:1' });
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.getByText('weekdays')).toBeInTheDocument();
    expect(screen.getByText('Wake-up Playlist')).toBeInTheDocument();
  });

  it('falls back to raw id when title unresolved', () => {
    rsum({ time: '07:30', days: 'all', queue: 'plex:zzz' });
    expect(screen.getByText('plex:zzz')).toBeInTheDocument();
  });

  it('shows em-dash for missing time', () => {
    rsum({ time: '', days: 'all', queue: 'plex:1' });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement**

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.jsx
import React from 'react';
import { Group, Text, Badge } from '@mantine/core';
import { useContentTitle } from '../hooks/useContentTitle.js';

export function ScheduledFireSummary({ row }) {
  const title = useContentTitle(row?.queue || '');
  const display = title || row?.queue || '(no queue)';
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" ff="monospace">{row?.time || '—'}</Text>
      <Text size="sm" c="dimmed">·</Text>
      <Badge size="xs" variant="light">{row?.days || 'all'}</Badge>
      <Text size="sm" c="dimmed">·</Text>
      <Text size="sm" truncate>{display}</Text>
    </Group>
  );
}

export default ScheduledFireSummary;
```

**Step 4: Run — expect PASS.**

**Step 5: Stage + review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.jsx \
        frontend/src/modules/Admin/PlaybackHub/components/ScheduledFireSummary.test.jsx
git diff --staged
git commit -m "feat(playback-hub): add ScheduledFireSummary subcomponent"
```

---

### Task 2.2: Wire collapse-row into `ScheduledFiresSection`

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx`

**Behavior spec:**
- Existing rows start collapsed; newly-added rows start expanded; dirty rows stay expanded.
- The row's natural identity is its `id` (server-assigned) for existing rows. For un-saved rows, generate a `_key` (e.g. `tmp-${counter}`) on `addRow` so the row tracks identity through expand/collapse.
- Use `row.id || row._key` as the stable key in `expandedKeys` and in the React `key` prop.
- The trash icon stays visible in **both** collapsed and expanded states. Keep the dual behavior from `ScheduledFiresSection.jsx:211-234` (saved rows → confirm modal; unsaved → silent local remove).

**Step 1: Add failing tests**

Add to `ScheduledFiresSection.test.jsx`:

```jsx
it('renders existing fires as collapsed (summary visible, form hidden)', () => {
  renderSection({
    target: 'red',
    fires: [{
      id: 'fire-1', time: '07:30', days: 'weekdays',
      target: 'red', queue: 'plex:670208', duration_min: 30,
    }],
    slotMaxVolume: 75,
    mutations,
  });
  expect(screen.getByText('07:30')).toBeInTheDocument();
  expect(screen.queryByLabelText(/time/i)).toBeNull();
  expect(screen.queryByLabelText(/duration/i)).toBeNull();
});

it('clicking expand chevron reveals the fire form', () => {
  renderSection({
    target: 'red',
    fires: [{
      id: 'fire-1', time: '07:30', days: 'weekdays',
      target: 'red', queue: 'plex:670208', duration_min: 30,
    }],
    slotMaxVolume: 75,
    mutations,
  });
  fireEvent.click(screen.getByRole('button', { name: /expand fire 1/i }));
  expect(screen.getByLabelText(/time/i)).toHaveValue('07:30');
  expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
});

it('newly added fire starts expanded', () => {
  renderSection({ target: 'red', fires: [], slotMaxVolume: 75, mutations });
  fireEvent.click(screen.getByRole('button', { name: /add fire/i }));
  expect(screen.getByLabelText(/time/i)).toBeInTheDocument();
});
```

**Step 2: Run — expect FAIL** on the three new tests.

**Step 3: Implement the collapse-row machinery**

Mirror Phase 1's approach in `ScheduledFiresSection.jsx`:

1. Import `ScheduledFireSummary` and `IconChevronDown`, `IconChevronUp`.
2. In the row state, add `_key` for unsaved rows: `addRow` does `_key: 'tmp-' + tmpCounter.current++`. Saved rows use `id` as the key.
3. `keyOf(row) = row.id || row._key`.
4. `useState(() => new Set())` for `expandedKeys`.
5. `addRow` pushes `keyOf(newRow)` into `expandedKeys`.
6. Build `baselineByKey` ref hydrated from incoming `fires` (compare against `fromWire`-mapped baseline).
7. `isRowDirty(row)` compares `{time, days, queue, indefinite, durationMin, volumeOverride}` against baseline.
8. `isExpanded(row) = expandedKeys.has(keyOf(row)) || isRowDirty(row)`.
9. When collapsed → render `<ScheduledFireSummary row={row} />` + expand chevron (`aria-label="expand fire N"`) + the existing trash `ActionIcon` block (preserve confirm-modal vs not-yet-saved behavior).
10. When expanded → render the existing form (no changes inside) plus a collapse chevron (`aria-label="collapse fire N"`).

**Step 4: Run — expect new tests PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx --reporter=verbose
```

**Step 5: Update the existing fire tests to expand before asserting on the form**

Existing tests that need an "expand first" call before reading form inputs / clicking form-internal buttons:

| Test | Fix |
|------|-----|
| `renders existing fires (filtered for target)` | Expand row 1 before reading inputs |
| `"Indefinite" checkbox disables the duration NumberInput` | Expand row 1 |
| `Save existing fire keeps the same id` | Expand before clicking Save fire |
| `Save converts wire snake_case duration_min/volume_override to camelCase` | Expand row 1 |
| `Save with Indefinite checked sends durationMin: null` | Expand row 1 |
| `does NOT close the confirm modal when deleteFire returns { ok: false }` | Trash icon stays in collapsed state — should NOT need expand |
| `Volume override NumberInput clamps to slotMaxVolume…` | Expand row 1 |

The "Add fire" / "empty state" / "Save new fire" / "does NOT mark new fire as saved on { ok: false }" tests need **no change** — new rows auto-expand.

The "Delete fires confirm modal" test should also not need a change if the trash icon is rendered in the collapsed state (it is, per the spec above).

Add a helper:

```jsx
function expandFire(n = 1) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`expand fire ${n}`, 'i') }));
}
```

**Step 6: Run all `ScheduledFiresSection.test.jsx` — expect PASS**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx --reporter=verbose
```

**Step 7: Add a regression test for fire dirty-tracking**

```jsx
it('dirty fire row stays expanded after attempted collapse', () => {
  renderSection({
    target: 'red',
    fires: [{
      id: 'fire-1', time: '07:30', days: 'weekdays',
      target: 'red', queue: 'plex:670208', duration_min: 30,
    }],
    slotMaxVolume: 75,
    mutations,
  });
  fireEvent.click(screen.getByRole('button', { name: /expand fire 1/i }));
  fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '08:00' } });
  fireEvent.click(screen.getByRole('button', { name: /collapse fire 1/i }));
  expect(screen.getByLabelText(/time/i)).toHaveValue('08:00');
});
```

Run — expect PASS.

**Step 8: Stage + review + commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx \
        frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx
git diff --staged
git commit -m "feat(playback-hub): collapse-row pattern for ScheduledFiresSection"
```

---

## Phase 3 — End-to-end card test + manual smoke

### Task 3.1: Confirm `DeviceCard.test.jsx` is still green

**Files:**
- Touch: none, just running.

**Step 1: Run the DeviceCard suite**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/components/DeviceCard.test.jsx --reporter=verbose
```

Expected: PASS — the DeviceCard renders sections inside an Accordion; section-internal changes shouldn't affect it. If anything red, fix the spec before moving on.

**Step 2: Run the entire PlaybackHub component suite as one final sweep**

```bash
npx vitest run frontend/src/modules/Admin/PlaybackHub/ --reporter=verbose
```

Expected: PASS across all files.

**No commit** — this task is a verification gate, not a code change.

---

### Task 3.2: Manual smoke against the running dev server

Per `docs/runbooks/playback-hub-admin-smoke.md` (referenced in `memory/reference_playback_hub_admin.md`).

**Step 1: Ensure dev server is up**

```bash
lsof -i :3111 || npm run dev   # follow the project's multi-environment rule
```

**Step 2: Open `/admin/playback-hub` in a browser**

Verify, for each slot that has windows/fires configured:

- [ ] Each window in "Continuous schedules" renders as a one-line summary with time range + title + (optional) `shuffle` chip.
- [ ] Each fire in "Scheduled fires" renders as one-line summary with time + days chip + title.
- [ ] Clicking the chevron on a row expands the form and the chevron flips to "up".
- [ ] Clicking "Add window" / "Add fire" inserts a new row that's **expanded by default**.
- [ ] Editing any field in an expanded row, then clicking the collapse chevron, keeps the row expanded (dirty-tracking).
- [ ] Saving rebaselines: after a successful save, the row can be collapsed.
- [ ] Trash icon works in both states.
- [ ] No console errors. No `data-pending` pulse leaks into the summary rows (they shouldn't have any pending state — that's transport-only).

**Step 3: If anything is off, fix and add a regression test before committing the fix.**

---

## Done criteria

- [ ] `useContentTitle` hook exists and is unit-tested.
- [ ] `LabeledContentPicker` uses the new hook (no behavior change).
- [ ] `ScheduleWindowSummary` and `ScheduledFireSummary` exist and are unit-tested.
- [ ] `SchedulesSection` collapse-row: existing rows collapsed by default, new rows expanded, dirty rows stick expanded.
- [ ] `ScheduledFiresSection` collapse-row: same three rules.
- [ ] Full vitest sweep at `frontend/src/modules/Admin/PlaybackHub/` is green.
- [ ] Manual smoke against the running admin page confirms scannability win.
- [ ] No changes to: mutations, wire shapes, REST routes, YAML datastore, validator parity fixtures, broadcaster, `DeviceCard.jsx` itself, `DeviceHeader`, `TransportRow`, `VolumeLimitsSection`, `HomeAutomationSection`.

## Reference

- Current section files reviewed at:
  - `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.jsx`
  - `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx`
  - `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx`
  - `frontend/src/modules/Admin/PlaybackHub/utils/titleCache.js`
- Existing test patterns:
  - `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx`
  - `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx`
- DDD layer map: `memory/reference_playback_hub_admin.md`.
