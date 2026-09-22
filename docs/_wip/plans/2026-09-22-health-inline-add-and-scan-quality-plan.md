# Health inline add + scan data quality — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every visible meal on Health → Today ends in an inline add input; Lunch
and Dinner are always the two columns; barcode captures stop producing junk rows,
missing icons, wrong units and all-caps names, and existing bad rows are repaired.

**Design:** [`2026-09-22-health-inline-add-and-scan-quality-design.md`](2026-09-22-health-inline-add-and-scan-quality-design.md).
**Audit:** [`../audits/2026-09-22-health-app-data-quality-audit.md`](../audits/2026-09-22-health-app-data-quality-audit.md).

**Architecture:** Part A is frontend only (`frontend/src/modules/Health/today/`):
`LogTable` renders two column stacks and asks its caller for each meal's add row
through a render prop; `AddCombobox` grows an `inline` mode; a new `MealAddRow`
composes it with photo/barcode/templates buttons. Part B is backend: a barcode
intake gate in the nutribot application layer, quarantine of nutrition-less scans
to the pending lane, OFF normalization fixes in the adapter, icon confinement in
the catalog service, and dry-run-first repair CLIs.

**Tech stack:** React 18 + Mantine, Vitest + Testing Library (frontend and
backend isolated tests), Playwright live flows (fixture-routed), Node ESM backend.

**Where:** worktree `.worktrees/health-inline-add`, branch `feat/health-inline-add`.
`node_modules` is symlinked from the main checkout.

**Running tests:** always file-scoped. The whole `frontend/src/modules/Health`
suite run at once times out ~7 heavy TodayView tests at 15 s under load; the
same files pass alone.

```bash
npx vitest run frontend/src/modules/Health/today/<file>.test.jsx
```

**Live Playwright flows** (`tests/live/flow/health/`) route every API call to
fixtures, but they need a dev server serving THIS branch. Never start a second
backend next to the running one (it is a live household controller). Run them
only when the single dev server is this worktree's.

**Commits:** one per task, on this branch. End each message with
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

# Part A — inline add row and two-meal layout

### Task A1: Primary meals and column order in the bucket contract

**Files:**
- Modify: `shared/contracts/health/mealBuckets.mjs`
- Modify: `frontend/src/modules/Health/today/mealBuckets.js`
- Test: `frontend/src/modules/Health/today/mealBuckets.test.js`

**Step 1: failing test** — append to `mealBuckets.test.js`:

```js
import { PRIMARY_BUCKETS, EARLY_COLUMN, LATE_COLUMN, BUCKETS } from './mealBuckets.js';

describe('meal columns', () => {
  it('Lunch and Dinner are the always-shown meals', () => {
    expect(PRIMARY_BUCKETS).toEqual(['afternoon', 'evening']);
  });
  it('the columns cover every bucket once, in day order', () => {
    expect(EARLY_COLUMN).toEqual(['morning', 'afternoon']);
    expect(LATE_COLUMN).toEqual(['evening', 'night']);
    expect([...EARLY_COLUMN, ...LATE_COLUMN]).toEqual(BUCKETS.map(b => b.id));
  });
});
```

(Add `describe/it/expect` to the existing vitest import if not already there.)

**Step 2:** `npx vitest run frontend/src/modules/Health/today/mealBuckets.test.js` → FAIL (`PRIMARY_BUCKETS` undefined).

**Step 3:** in `shared/contracts/health/mealBuckets.mjs`, after `MEAL_BUCKETS`:

```js
// The two meals every day shows, empty or not. Lunch heads the early column
// and Dinner the late one; Breakfast and Snacks appear only when they hold
// food, above Lunch and below Dinner respectively.
export const PRIMARY_BUCKETS = Object.freeze(['afternoon', 'evening']);
export const EARLY_COLUMN = Object.freeze(['morning', 'afternoon']);
export const LATE_COLUMN = Object.freeze(['evening', 'night']);
```

In `frontend/src/modules/Health/today/mealBuckets.js` change the first import and add a re-export:

```js
import { MEAL_BUCKETS, bucketForHour, PRIMARY_BUCKETS, EARLY_COLUMN, LATE_COLUMN } from '@shared-contracts/health/mealBuckets.mjs';
...
export { bucketForHour, PRIMARY_BUCKETS, EARLY_COLUMN, LATE_COLUMN };
```

**Step 4:** rerun → PASS.

**Step 5:** commit `feat(health): name the primary meals and column order in the bucket contract`.

---

### Task A2: `AddCombobox` inline mode

**Files:**
- Modify: `frontend/src/modules/Health/today/AddCombobox.jsx`
- Test: `frontend/src/modules/Health/today/AddCombobox.test.jsx`

Behaviour (design § "The inline add row"): no fetch and no list until focused
or typed into; Enter/pick logs to `bucketId` on `date`; on success clear, keep
focus, and **reset the operation id** (`operationRequest` fingerprints the
payload, so adding the same food twice in a row would otherwise reuse the id
and the server would coalesce the second add as a retry of the first);
Escape clears, then blurs.

**Step 1: failing tests** — append a `describe('AddCombobox inline', …)` to
`AddCombobox.test.jsx` (reuses the file's `apiMock`, `r`, `SUGGEST`):

```jsx
describe('AddCombobox inline', () => {
  beforeEach(() => { apiMock.mockReset(); });
  const inline = (props = {}) => r(<AddCombobox inline bucketId="evening" label="Dinner" date="2026-09-21"
    onDone={() => {}} {...props} />);

  it('is labelled for its meal and fetches nothing until focused', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    expect(input.getAttribute('placeholder')).toBe('Add to Dinner…');
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('bucket=evening&limit=8')));
    expect(await screen.findByText('Chicken breast')).toBeTruthy();
  });

  it('Enter on free text parses into this meal and day, then clears and stays focused', async () => {
    apiMock.mockImplementation(async (path) => path.includes('suggest') ? { items: [] } : { committed: true });
    const onDone = vi.fn();
    inline({ onDone });
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'two eggs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      expect.objectContaining({ type: 'text', content: 'two eggs', bucket: 'evening', date: '2026-09-21' }), 'POST');
    expect(input.value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('logging the same food twice sends two distinct operation ids', async () => {
    const ids = [];
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      ids.push(body.operationId); return { logged: true, item: { uuid: `r${ids.length}` } };
    });
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('Chicken breast'));
    await waitFor(() => expect(ids).toHaveLength(1));
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText('Chicken breast'));
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('Escape clears the text first, then blurs', () => {
    apiMock.mockResolvedValue({ items: [] });
    inline();
    const input = screen.getByRole('combobox', { name: 'Add to Dinner' });
    input.focus();
    fireEvent.change(input, { target: { value: 'oat' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });

  it('a focusRequest change focuses the input', () => {
    apiMock.mockResolvedValue({ items: [] });
    const { rerender } = inline({ focusRequest: 0 });
    rerender(<MantineProvider><AddCombobox inline bucketId="evening" label="Dinner" onDone={() => {}} focusRequest={1} /></MantineProvider>);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Add to Dinner' }));
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/Health/today/AddCombobox.test.jsx` → the five new tests FAIL; existing tests pass.

**Step 3: implement.** Edits to `AddCombobox.jsx`:

1. Signature:
   ```js
   export function AddCombobox({ bucketId, date = null, onDone, onCancel, onMeals, onTemplate, onManageFoods,
     inline = false, label = null, focusRequest = 0, actions = null }) {
   ```
2. New state/refs after `listId`:
   ```js
   const inputRef = useRef(null);
   const [focused, setFocused] = useState(false);
   const surface = inline ? 'inline' : 'sheet';
   // Inline rows sit on every visible meal at once, so each one fetches and
   // draws its shortlist only while it is being used.
   const open = !inline || focused || text.trim().length > 0;
   useEffect(() => { if (focusRequest) inputRef.current?.focus(); }, [focusRequest]);
   ```
3. Suggest effect: first line `if (!open) return undefined;`, deps `[text, bucketId, open]`.
4. Add a completion helper above `pick`:
   ```js
   // The sheet unmounts on success. The inline row stays: clear it, forget
   // the operation id (the next add is a new intent even when the payload is
   // identical), and hand focus back for the next food.
   const finish = (result) => {
     if (inline) {
       requestRef.current = null;
       setText(''); setHighlight(-1); setPhase('typing');
       setTimeout(() => inputRef.current?.focus(), 0);
     }
     onDone?.(result);
   };
   ```
   In `pick`: replace `onDone();` with `finish();` and the log line with
   `logger.info('quickadd.done', { entry: entry.name, bucket: bucketId, surface });`.
   In `submitSentence`: replace `else onDone(result);` with `else finish(result);`
   and `logger.info('sentence.committed', {});` with
   `logger.info('sentence.committed', { bucket: bucketId, surface });`.
5. Escape in `onKeyDown`:
   ```js
   if (e.key === 'Escape') {
     if (!inline) return onCancel();
     e.preventDefault();
     if (text) { setText(''); requestRef.current = null; } else inputRef.current?.blur();
     return;
   }
   ```
6. Render — wrap the input with the actions, gate the list, keep focus when a
   suggestion is pressed:
   ```jsx
   <div className={`health-suggest${inline ? ' health-suggest--inline' : ''}`}>
     <div className="health-suggest__field">
       <TextInput ref={inputRef} autoFocus={!inline} size="sm" value={text}
         placeholder={inline ? `Add to ${label}…` : 'Food name, or a sentence to parse…'}
         aria-label={inline ? `Add to ${label}` : 'Food name or sentence'} role="combobox"
         aria-expanded={open ? 'true' : 'false'} aria-controls={listId}
         aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
         disabled={phase === 'parsing'}
         onFocus={() => { setFocused(true); if (inline) logger.debug('add-row.focus', { bucket: bucketId }); }}
         onBlur={() => setFocused(false)}
         onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
         rightSection={phase === 'parsing' ? <Loader size="xs" /> : null} />
       {actions}
     </div>
     {error ? <p className="health-suggest__error">{error.message}</p> : null}
     {open ? <ul id={listId} className="health-suggest__list" role="listbox" aria-label="Suggested foods"
       onMouseDown={(e) => e.preventDefault()}>
       …existing items.map(…) unchanged…
     </ul> : null}
     …existing Log sentence / Meals & templates / Manage saved foods, each additionally gated on `open`…
   </div>
   ```
   `onMouseDown` preventDefault keeps the input focused while a suggestion is
   clicked; without it, blur would unmount the list before the click lands.

**Step 4:** rerun the file → all PASS (old + new).

**Step 5:** commit `feat(health): inline mode for the add combobox`.

---

### Task A3: `MealAddRow`

**Files:**
- Create: `frontend/src/modules/Health/today/MealAddRow.jsx`
- Test: `frontend/src/modules/Health/today/MealAddRow.test.jsx`

**Step 1: failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })) }));
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ bucket, labelPrefix, mealLabel }) => <button>{`${labelPrefix} to ${mealLabel} (${bucket})`}</button>,
}));
import { MealAddRow } from './MealAddRow.jsx';

const r = ui => render(<MantineProvider>{ui}</MantineProvider>);

describe('MealAddRow', () => {
  it('offers type, photo, barcode and saved meals for its own meal', () => {
    const onOpenBarcode = vi.fn(), onOpenTemplates = vi.fn();
    r(<MealAddRow bucket="afternoon" label="Lunch" date="2026-09-21" onAdded={() => {}}
      onPhotoCapture={() => {}} onOpenBarcode={onOpenBarcode} onOpenTemplates={onOpenTemplates} />);
    expect(screen.getByRole('combobox', { name: 'Add to Lunch' })).toBeTruthy();
    expect(screen.getByText('Photo to Lunch (afternoon)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode to Lunch' }));
    expect(onOpenBarcode).toHaveBeenCalledWith('afternoon');
    fireEvent.click(screen.getByRole('button', { name: 'Saved meals for Lunch' }));
    expect(onOpenTemplates).toHaveBeenCalledWith('afternoon', null);
  });
});
```

**Step 2:** run → FAIL (module not found).

**Step 3: implement** `MealAddRow.jsx`:

```jsx
import { ActionIcon } from '@mantine/core';
import { AddCombobox } from './AddCombobox.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';

const BarcodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 3v12M5 3v12M7.5 3v12M10 3v12M13 3v12M16 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const MealsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M3 4h12M3 9h12M3 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** The add input at the foot of one meal: typing is the default, and the
 * photo / barcode / saved-meal routes sit beside it for that same meal. */
export function MealAddRow({ bucket, label, date, focusRequest = 0, busy = false,
  onAdded, onPhotoCapture, onOpenBarcode, onOpenTemplates, onManageFoods }) {
  return <div className="health-meal__add-row">
    <AddCombobox inline bucketId={bucket} label={label} date={date} focusRequest={focusRequest}
      onDone={onAdded} onManageFoods={onManageFoods}
      onTemplate={entry => onOpenTemplates(bucket, entry.id)}
      actions={<span className="health-meal__add-actions">
        <PhotoCapture bucket={bucket} mealLabel={label} labelPrefix="Photo" busy={busy}
          className="health-meal__add-action" onCapture={onPhotoCapture} />
        <ActionIcon variant="subtle" className="health-meal__add-action" aria-label={`Scan barcode to ${label}`}
          onClick={() => onOpenBarcode(bucket)}><BarcodeIcon /></ActionIcon>
        <ActionIcon variant="subtle" className="health-meal__add-action" aria-label={`Saved meals for ${label}`}
          onClick={() => onOpenTemplates(bucket, null)}><MealsIcon /></ActionIcon>
      </span>} />
  </div>;
}
export default MealAddRow;
```

**Step 4:** run → PASS.

**Step 5:** commit `feat(health): MealAddRow — per-meal add input with photo, barcode, saved meals`.

---

### Task A4: `LogTable` — two column stacks, primaries always shown, add row per meal

**Files:**
- Modify: `frontend/src/modules/Health/today/LogTable.jsx`
- Modify: `frontend/src/modules/Health/health.scss:319-325`
- Modify: `frontend/src/modules/Health/today/mealWorkflow.scss:8`
- Test: `frontend/src/modules/Health/today/LogTable.test.jsx`, `LogTable.workflow.test.jsx`

**Step 1: tests.** In `LogTable.test.jsx`:

- Replace the `'per-meal capture controls (Task 4.2)'` tests
  `'meal headers do not repeat capture controls'` and
  `'Add food preserves the chosen meal target'` with:

```jsx
const addRow = (bucket, label) => <input aria-label={`Add to ${label}`} data-bucket={bucket} />;

it('an empty day shows Lunch and Dinner, each ending in its own add row', () => {
  render(<LogTable byBucket={emptyByBucket} sessions={[]} renderAddRow={addRow} onRowTap={() => {}} />, { wrapper });
  expect(screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)).toEqual(['Lunch', 'Dinner']);
  const lunch = screen.getByText('Lunch').closest('section');
  expect(lunch.querySelector('[aria-label="Add to Lunch"]')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Add food to/ })).toBeNull();
  expect(document.querySelector('.health-log__empty-meals')).toBeNull();
});

it('Breakfast joins the early column above Lunch, Snacks the late column below Dinner', () => {
  const day = new Map([['morning', [{ uuid: 'b', name: 'Oats', mealTime: 'morning', calories: 150 }]],
    ['night', [{ uuid: 's', name: 'Tea', mealTime: 'night', calories: 0 }]]]);
  render(<LogTable byBucket={day} sessions={[]} renderAddRow={addRow} onRowTap={() => {}} />, { wrapper });
  const [early, late] = document.querySelectorAll('.health-log__column');
  expect([...early.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Breakfast', 'Lunch']);
  expect([...late.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Dinner', 'Snacks']);
});

it('a revealed meal shows even while empty', () => {
  render(<LogTable byBucket={emptyByBucket} sessions={[]} revealedBucket="morning" renderAddRow={addRow} onRowTap={() => {}} />, { wrapper });
  expect(screen.getByText('Breakfast')).toBeTruthy();
});
```

  (Check how `emptyByBucket` is defined at the top of the file; if it is not an
  empty `Map`, use `new Map()`.)

- Replace the `describe('anticipated meal capture', …)` block with:

```jsx
describe('clock does not open empty meals', () => {
  it('at 21:30 Snacks stays hidden and Dinner stays shown', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T21:30:00'));
    try {
      render(<LogTable byBucket={new Map()} date="2026-09-06" onVoiceCapture={() => {}} onRowTap={() => {}} />, { wrapper });
      expect(screen.getByRole('button', { name: 'Log by voice to Dinner' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Log by voice to Snacks' })).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
```

- In `LogTable.workflow.test.jsx` delete the test
  `'updates anticipated meals on a running clock and keeps existing dinner'`
  (the behaviour is retired; the new test above covers the replacement).

**Step 2:** run both files → new tests FAIL.

**Step 3: implement in `LogTable.jsx`.**

1. Imports: `import { BUCKETS, UNGROUPED, EARLY_COLUMN, LATE_COLUMN, PRIMARY_BUCKETS } from './mealBuckets.js';`
   Delete the `currentMealBucketId, localTodayISO` import and the `useEffect`
   clock refresher (`refreshClock`, 15 s interval, focus listener) — it existed
   only for the anticipated meal.
2. `Section`: remove the `onAdd` prop and the header `+` button
   (`health-meal__add`); add an `addRow` prop rendered as the section's last
   child, after the capture-progress block:
   ```jsx
   {addRow}
   ```
3. `LogTable` props: remove `onAddTo, addSlot, addingTo`; add
   `revealedBucket = null, renderAddRow = null`.
4. Visibility:
   ```js
   const visible = b => PRIMARY_BUCKETS.includes(b.id) || revealedBucket === b.id
     || byBucket.get(b.id)?.length || heldSections.has(`${date}:${b.id}`) || clarifications?.has(`${date}:${b.id}`)
     || capturePendingBucket === b.id || capturePendingBuckets.includes(b.id);
   ```
   (`coldLoading` no longer forces sections open; the primaries are always
   there, so a cold start no longer flashes four shimmering sections.)
5. Render: move the per-bucket JSX into `const renderBucket = (b) => (…)`,
   dropping `onAdd={…}` and `{addingTo === b.id && addSlot ? addSlot : null}`,
   and passing `addRow={renderAddRow ? renderAddRow(b.id, b.label) : null}`. Then:
   ```jsx
   <div className="health-log">
     {[EARLY_COLUMN, LATE_COLUMN].map((ids, index) => (
       <div key={index} className="health-log__column">
         {ids.map(id => BUCKETS.find(b => b.id === id)).filter(visible).map(renderBucket)}
       </div>
     ))}
     {…exercise section unchanged…}
     {orphans.length ? <div className="health-log__wide">{…Ungrouped Section unchanged…}</div> : null}
   </div>
   ```
   Delete the `health-log__empty-meals` block.

**SCSS** — `health.scss` lines 319-325 become:

```scss
.health-log { display: grid; gap: 0.5rem 1rem; align-items: start; }
@media (min-width: $health-aside-breakpoint) {
  .health-log { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
// Lunch heads the early column and Dinner the late one on every day, so the
// two meals keep their places whether or not either has food yet.
.health-log__column { display: grid; gap: 0.5rem; align-content: start; min-width: 0; }
.health-log__wide, .health-meal--exercise { grid-column: 1 / -1; }
.health-meal__add-row { margin-top: 0.25rem; }
.health-suggest__field { display: flex; align-items: center; gap: 4px; > :first-child { flex: 1; min-width: 0; } }
.health-meal__add-actions { display: inline-flex; align-items: center; gap: 2px; color: var(--ds-text-mid); }
```

`mealWorkflow.scss:8`: drop `.health-meal-add-options, ` from the selector list.

**Step 4:** run `LogTable.test.jsx`, `LogTable.workflow.test.jsx`, `LogTable.recording.test.jsx` → PASS.

**Step 5:** commit `feat(health): Lunch and Dinner columns, add row at the foot of every meal`.

---

### Task A5: `TodayView` wiring; the quick bar reveals and focuses a meal

**Files:**
- Modify: `frontend/src/modules/Health/today/TodayView.jsx`
- Modify: `frontend/src/modules/Health/today/QuickCaptureBar.jsx` (doc comment only)
- Test: `frontend/src/modules/Health/today/TodayView.test.jsx`

**Step 1: tests.** In `TodayView.test.jsx`:

- Line ~315 (`expect(screen.getByRole('button', { name: 'Add food to Breakfast' }))…`):
  replace with `expect(screen.getByRole('combobox', { name: 'Add to Dinner' })).toBeTruthy();`
- Line ~542 (`'REGRESSION: the per-meal capture buttons…'`): replace
  `getByRole('button', {name:'Add food to Dinner'})` with
  `getByRole('combobox', { name: 'Add to Dinner' })`. The `MockPhotoCapture-morning`
  wait on the line above it becomes `MockPhotoCapture-afternoon` (Breakfast is no
  longer open on an empty morning).
- Add:

```jsx
it('the quick bar + reveals a hidden meal and focuses its add row', async () => {
  apiMock.mockImplementation(baseApi({}));
  r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
  await waitFor(() => screen.getByRole('combobox', { name: 'Add to Lunch' }));
  expect(screen.queryByRole('combobox', { name: 'Add to Breakfast' })).toBeNull();
  act(() => quickBarProps.current.onAddTo('morning'));
  const input = await screen.findByRole('combobox', { name: 'Add to Breakfast' });
  await waitFor(() => expect(document.activeElement).toBe(input));
});
```

  Check how the file stubs `QuickCaptureBar` (top of file). If the stub does not
  already capture its props, change it to
  `QuickCaptureBar: (props) => { quickBarProps.current = props; return null; }`
  with `const quickBarProps = { current: null };` declared before `vi.mock` via
  `vi.hoisted`.

**Step 2:** run `TodayView.test.jsx` → FAIL.

**Step 3: implement in `TodayView.jsx`.**

1. Replace `const [addingTo, setAddingTo] = useState(null);` (and the `typingIn`
   state) with
   ```js
   // The quick bar's + names a meal; that meal is shown (even if empty) and its
   // add row takes focus. `n` makes a repeat tap on the same meal refocus.
   const [focusRequest, setFocusRequest] = useState(null);
   const revealMeal = bucket => setFocusRequest(prev => ({ bucket, n: (prev?.n || 0) + 1 }));
   ```
2. `QuickCaptureBar … onAddTo={revealMeal}`.
3. `LogTable`: remove `onAddTo`, `addingTo`, `addSlot`; add
   ```jsx
   revealedBucket={focusRequest?.bucket ?? null}
   renderAddRow={(bucket, label) => <MealAddRow bucket={bucket} label={label} date={date}
     focusRequest={focusRequest?.bucket === bucket ? focusRequest.n : 0} busy={nutrition.busy}
     onAdded={() => day.reload()} onPhotoCapture={onPhotoCapture} onOpenBarcode={openBarcode}
     onOpenTemplates={(target, templateId) => { setFocusTemplateId(templateId); setTemplatesFor(target); }}
     onManageFoods={() => setManageFoods(true)} />}
   ```
4. `TemplatePicker onLogged`: drop `setAddingTo(null);`.
5. Imports: add `import { MealAddRow } from './MealAddRow.jsx';`; remove
   `AddCombobox` and any now-unused `PhotoCapture` import (keep it if used
   elsewhere in the file — grep first).
6. `QuickCaptureBar.jsx` doc comment: "Per-meal Add reuses it with a fixed
   target" → "Its + reveals the chosen meal on Today and focuses that meal's add
   row." No behaviour change there.

**Step 4:** run `TodayView.test.jsx`, `QuickCaptureBar.test.jsx`, `viewedDate.test.jsx`,
`sharedFold.test.jsx` (each file alone) → PASS.

**Step 5:** commit `feat(health): per-meal add rows replace the + panel; quick bar reveals and focuses`.

---

### Task A6: Live Playwright selectors

**Files (modify):** in `tests/live/flow/health/`:
`health-fast-log.runtime.test.mjs:8`, `health-interactions.runtime.test.mjs:31`,
`health-completion.runtime.test.mjs:63`, `health-sentence-parse.runtime.test.mjs:32-33`,
`health-context.runtime.test.mjs:11-12,22`, `meal-workflow.verify.mjs:57-59`.

Replace each `page.getByRole('button', { name: /Add food to/ }).first().click();`
with

```js
await page.getByRole('combobox', { name: 'Add to Lunch' }).click();
```

(`.last()` in `health-context` → `'Add to Dinner'`.) Where a test then addresses
`getByRole('combobox')` or `{ name: 'Food name or sentence' }`, use the same
named locator instead (there are now several comboboxes on the page). In
`meal-workflow.verify.mjs` delete the two `Add food to Dinner` clicks and the
`count() === 0` assertion between them; the Dinner section is always present.

**Verify:** only if the single running dev server is serving this worktree:
`npx playwright test tests/live/flow/health/ --reporter=line`. Otherwise
record in the task's commit message that the live flows were updated but not run.

**Commit:** `test(health): live flows use the per-meal add row`.

---

### Task A7: Docs

**Files:**
- `docs/reference/health/README.md:216` — "each bucket's '+ Add food…' row" →
  "Lunch and Dinner always render; each visible meal ends in its add row".
  `:251` — "inline Add food surface…" describes the suggestion panel; add one
  sentence: "It opens under a meal's add row only while that row has focus or
  text."
- `docs/reference/health/meal-commands.md:66-70` — replace "The current local
  meal has a temporary empty section… Plus opens explicit capture choices; text
  catalog suggestions appear only after choosing Type food." with: "Lunch and
  Dinner are always shown, in the left and right columns; Breakfast and Snacks
  appear when they hold food, when a capture or clarification is in flight for
  them, or when chosen in the quick bar. Every visible meal ends in an add row:
  type to search or parse, or use its photo, barcode and saved-meal buttons."
- `docs/reference/health/health-app-frontend.md` — add `MealAddRow` to the
  component list; mention `add-row.focus` and the `surface` field on
  `quickadd.done` / `sentence.committed`.

**Commit:** `docs(health): per-meal add row and fixed Lunch/Dinner columns`.

---

# Part B — scan data quality

Code facts this part relies on (verified 2026-09-22):

- Every UPC capture — kitchen relay, `/api/v1/nutribot/upc`, Telegram, web —
  runs `LogFoodFromUPC.execute` (`backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`).
  That is the one place for barcode *shape* checks.
- Relay scans reach it through `handleProduct` in
  `backend/src/3_applications/scan/ScanIngressCoordinator.mjs:610`. Each relay
  scan gets its own `operationId`, so repeats are NOT deduplicated downstream;
  repeat suppression belongs in `handleProduct`.
- Relay ISBNs (13 digits, 978/979) already parse to the `book` namespace
  (`backend/src/2_domains/scan/ScanCode.mjs:283`) and never reach UPC lookup.
  HTTP/Telegram/web paths do not parse first, so the use-case gate must also
  refuse ISBNs.
- `NutriLog.create` makes a `pending` log; `reviewService.capture` is what
  accepts it into the NutriList ledger. A pending log already shows in Health's
  Needs Review section (Barcode tag, "Calories need review", Review food /
  Discard) and is excluded from the budget.
- Backend tests: vitest, co-located `<Name>.<aspect>.test.mjs`. Run one file with
  `npx vitest run <path>`. `tests/unit/**` files may be jest; check the import line.
- Shared contracts import as `#shared/contracts/...` from backend code.

### Task B1: GTIN parsing in the nutrition domain

**Files:**
- Create: `backend/src/2_domains/nutrition/services/gtin.mjs`
- Test: `backend/src/2_domains/nutrition/services/gtin.test.mjs`

**Step 1: failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseGtin } from './gtin.mjs';

describe('parseGtin', () => {
  it.each([
    ['037000338369', '037000338369'],   // UPC-A
    ['0049000000450', '0049000000450'], // EAN-13 with leading zero
    ['012345678905', '012345678905'],
    ['96385074', '96385074'],           // EAN-8
  ])('accepts %s', (raw, code) => {
    expect(parseGtin(raw)).toEqual({ ok: true, code, collapsed: false });
  });

  it('collapses two reads glued together', () => {
    expect(parseGtin('037000338369037000338369')).toEqual({ ok: true, code: '037000338369', collapsed: true });
  });

  it.each([
    ['', 'empty'],
    ['12345', 'length'],
    ['0370003383690', 'check-digit'],
    ['037000338368', 'check-digit'],
    ['9780306406157', 'isbn'],
    ['9791234567896', 'isbn'],
  ])('refuses %s (%s)', (raw, reason) => {
    expect(parseGtin(raw)).toMatchObject({ ok: false, reason });
  });

  it('ignores non-digits around the code', () => {
    expect(parseGtin(' 0370-0033-8369 ')).toMatchObject({ ok: true, code: '037000338369' });
  });
});
```

**Step 2:** `npx vitest run backend/src/2_domains/nutrition/services/gtin.test.mjs` → FAIL.

**Step 3:** `gtin.mjs`

```js
/**
 * Barcode shape for FOOD lookups. A GTIN is 8, 12, 13 or 14 digits ending in a
 * mod-10 check digit. The shared kitchen reader also sees books, and a held
 * trigger can emit the same code twice without a terminator; both must be
 * caught before a product database answers them with a nonsense food.
 */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const ISBN13 = /^97[89]/;

export function gtinCheckDigitValid(digits) {
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(digits[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** @returns {{ok:true, code:string, collapsed:boolean} | {ok:false, reason:string, code?:string}} */
export function parseGtin(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'empty' };
  const half = digits.length / 2;
  if (Number.isInteger(half) && GTIN_LENGTHS.has(half) && digits.slice(0, half) === digits.slice(half)) {
    const single = parseGtin(digits.slice(0, half));
    return single.ok ? { ...single, collapsed: true } : single;
  }
  if (!GTIN_LENGTHS.has(digits.length)) return { ok: false, reason: 'length', code: digits };
  if (digits.length === 13 && ISBN13.test(digits)) return { ok: false, reason: 'isbn', code: digits };
  if (!gtinCheckDigitValid(digits)) return { ok: false, reason: 'check-digit', code: digits };
  return { ok: true, code: digits, collapsed: false };
}
```

**Step 4:** rerun → PASS. (If `96385074` fails, compute a valid EAN-8 with
`gtinCheckDigitValid` rather than weakening the function.)

**Step 5:** commit `feat(nutrition): GTIN parsing — check digit, doubled reads, ISBN refusal`.

---

### Task B2: `LogFoodFromUPC` refuses malformed codes and quarantines empty products

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
- Test: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.gate.test.mjs` (new)

**Step 1: failing test** (harness copied from `LogFoodFromUPC.catalog.test.mjs`, plus a review service):

```js
import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messaging = () => ({ sendMessage: vi.fn(async () => ({ messageId: 'm1' })), sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}), deleteMessage: vi.fn(async () => {}) });
const product = (nutrition) => ({ upc: '037000338369', name: 'Magazine', serving: { size: 1, unit: 'serving' }, nutrition,
  nutritionLookup: { source: 'openfoodfacts', warnings: ['Nutrition unavailable'] } });
const make = (gatewayHit) => {
  const saved = [];
  const foodLogStore = { save: vi.fn(async log => { saved.push(log); }), findById: vi.fn(async () => saved.at(-1)) };
  const reviewService = { capture: vi.fn(async () => {}) };
  const upcGateway = { lookup: vi.fn(async () => gatewayHit) };
  const uc = new LogFoodFromUPC({ messagingGateway: messaging(), upcGateway, foodLogStore, reviewService,
    logger: { debug() {}, info: vi.fn(), warn() {}, error() {} } });
  return { uc, upcGateway, foodLogStore, reviewService };
};

describe('LogFoodFromUPC intake gate', () => {
  it('refuses a code with a bad check digit before any lookup', async () => {
    const { uc, upcGateway } = make(null);
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338368', headless: true });
    expect(out).toMatchObject({ success: false, rejected: 'check-digit' });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
  });

  it('refuses an ISBN', async () => {
    const { uc, upcGateway } = make(null);
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '9780306406157', headless: true });
    expect(out).toMatchObject({ success: false, rejected: 'isbn' });
    expect(upcGateway.lookup).not.toHaveBeenCalled();
  });

  it('looks up the collapsed code for a doubled read', async () => {
    const { uc, upcGateway } = make(product({ calories: 100 }));
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369037000338369', headless: true });
    expect(upcGateway.lookup).toHaveBeenCalledWith('037000338369');
  });
});

describe('LogFoodFromUPC quarantine', () => {
  it('a product with no nutrition at all stays pending and is never accepted into the ledger', async () => {
    const { uc, reviewService, foodLogStore } = make(product({ calories: null, protein: null, carbs: null, fat: null }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out).toMatchObject({ success: true, quarantined: true, committed: false });
    expect(foodLogStore.save).toHaveBeenCalled();
    expect(reviewService.capture).not.toHaveBeenCalled();
  });

  it('a product with a known zero is not quarantined', async () => {
    const { uc, reviewService } = make(product({ calories: 0, protein: 0, carbs: 0, fat: 0 }));
    const out = await uc.execute({ userId: 'u', conversationId: 'c', upc: '037000338369', headless: true });
    expect(out.quarantined).toBeFalsy();
    expect(reviewService.capture).toHaveBeenCalled();
  });
});
```

**Step 2:** `npx vitest run backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.gate.test.mjs` → FAIL.

**Step 3: implement.**

1. Import: `import { parseGtin } from '#domains/nutrition/services/gtin.mjs';`
2. In `#execute`, destructure `upc: rawUpc` instead of `upc`, and add immediately after the destructure:
   ```js
   // Shape before lookup. Every UPC path (relay, HTTP, Telegram, web) lands here,
   // and only the relay parses the code first. A bad check digit, an ISBN from the
   // shared reader, or two reads glued together must not become a food.
   const gtin = parseGtin(rawUpc);
   if (!gtin.ok) {
     this.#logger.info?.('upc.rejected', { upc: rawUpc, reason: gtin.reason });
     return { success: false, error: 'Invalid barcode', rejected: gtin.reason, upc: rawUpc };
   }
   const upc = gtin.code;
   if (gtin.collapsed) this.#logger.info?.('upc.collapsed', { raw: rawUpc, upc });
   ```
   Place it before the status message is sent, so a refused code sends nothing.
   (If a later line reassigns `upc`, change it to use the new `const`; `grep -n "upc =" LogFoodFromUPC.mjs`.)
3. After `foodItem` is built (and after `resolveIdentity`), add:
   ```js
   // Nothing known at all (not even a zero) is not a food we can count. It stays
   // a pending capture — shown in Needs Review, outside the budget — instead of a
   // committed row of dashes that puts "+" on the day's totals.
   const quarantined = NUTRIENTS.every(key => foodItem[key] == null);
   ```
4. Step 7: `if (this.#reviewService && !quarantined) { …capture… }`, then
   ```js
   if (quarantined) this.#logger.info?.('upc.quarantined', { upc, name: product.name, logUuid: nutriLog.id });
   ```
5. Step 7b: add `&& !quarantined` to the `recordUsage` condition.
6. Add `quarantined` to the success return object.

**Step 4:** rerun the new file, then the existing ones:
`npx vitest run backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs backend/src/3_applications/nutribot/usecases/viewedDate.test.mjs backend/src/3_applications/nutribot/services/NutribotInputRouter.autocommit.test.mjs`
and the jest suite `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/applications/nutribot/LogFoodFromUPC.test.mjs`.
Any fixture UPC that now fails the check digit gets a valid one (compute with
`gtinCheckDigitValid`), never a weaker gate.

**Step 5:** commit `feat(nutribot): refuse malformed barcodes; quarantine nutrition-less scans as pending`.

---

### Task B3: Relay repeat suppression

**Files:**
- Modify: `backend/src/3_applications/scan/ScanIngressCoordinator.mjs`
- Test: `tests/unit/composition/scanDispatch.test.mjs` (vitest)

**Step 1: failing test** — add inside the file's top-level `describe`:

```js
describe('product repeat suppression', () => {
  const productScan = (code) => relayScan({ device: 'nutribot-upc', route: 'nutribot', code });
  it('drops the same code from the same reader within 30 s, and a doubled read of it', async () => {
    let t = 1_000_000;
    const h = harness({ now: () => t });
    await h.scanDispatch.handleScan(productScan('037000338369'));
    t += 15_000;
    const repeat = await h.scanDispatch.handleScan(productScan('037000338369'));
    await h.scanDispatch.handleScan(productScan('037000338369037000338369'));
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(repeat).toMatchObject({ ok: false });
    expect(h.barcodeLogger.info).toHaveBeenCalledWith('barcode.nutribot.repeat', expect.objectContaining({ sinceMs: 15_000 }));
    t += 31_000;
    await h.scanDispatch.handleScan(productScan('037000338369'));
    expect(h.execute).toHaveBeenCalledTimes(2);
  });
});
```

Check that `makeDeps(over)` forwards unknown keys such as `now` into `deps`; if
it builds `deps` field by field, add `...(over.now ? { now: over.now } : {})`.

**Step 2:** `npx vitest run tests/unit/composition/scanDispatch.test.mjs` → FAIL
(first as "unknown dep `now`" from the contract check, then on the count).

**Step 3: implement.**

1. `import { parseGtin } from '#domains/nutrition/services/gtin.mjs';`
2. `OPTIONAL_DEPS` gains
   `now: { ok: v => typeof v === 'function', want: 'a () => epoch-ms clock' },`
   and the destructure gains `now = () => Date.now(),`.
3. Above `handleProduct`:
   ```js
   // A held trigger re-fires: 2026-09-21 logged the same can six times in 15 s,
   // some reads glued into one 24-digit code. Each relay scan carries its own
   // operation id, so nothing downstream can tell a re-fire from a second can.
   // A deliberate second serving is a portion edit, not a rescan.
   const PRODUCT_REPEAT_MS = 30_000;
   const lastProductScan = new Map(); // `${device}|${gtin}` -> epoch ms of the accepted scan
   ```
4. In `handleProduct`, after the `if (!userId)` guard:
   ```js
   const at = now();
   for (const [key, seen] of lastProductScan) if (at - seen >= PRODUCT_REPEAT_MS) lastProductScan.delete(key);
   const parsed = parseGtin(body);
   const repeatKey = `${device}|${parsed.ok ? parsed.code : String(body)}`;
   if (lastProductScan.has(repeatKey)) {
     emit(barcodeLogger, 'info', 'barcode.nutribot.repeat', { device, code: raw, sinceMs: at - lastProductScan.get(repeatKey) });
     return { status: 'swallowed', ok: false, message: 'repeat scan' };
   }
   lastProductScan.set(repeatKey, at);
   ```
5. Update the JSDoc `@param` list for `createScanDispatch` with `deps.now` (OPTIONAL).

**Step 4:** rerun `scanDispatch.test.mjs` and `scanDispatchNutriscanAck.test.mjs` → PASS.

**Step 5:** commit `feat(scan): suppress repeat product scans from one reader within 30 s`.

---

### Task B4: Open Food Facts serving normalization

**Files:**
- Modify: `backend/src/1_adapters/nutribot/normalizeProductNutrition.mjs`
- Test: `backend/src/1_adapters/nutribot/normalizeProductNutrition.test.mjs`

Real payloads from the audit (trimmed to the fields used):

```js
const OIKOS = { serving_size: '0.75 cup (170 g)', serving_quantity: 170, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_serving': 160, 'energy-kcal_100g': 94.1 } };
const CHEESE = { serving_size: '1/4 cup (28 g)', serving_quantity: 28, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_100g': 392.86 } };
const DIET_COKE = { serving_size: null, serving_quantity: null, serving_quantity_unit: null, quantity: '12 fl oz',
  nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } };
const PEANUT_BUTTER = { serving_size: '2 tbsp (2 tbsp)', serving_quantity: null, serving_quantity_unit: 'g',
  nutriments: { 'energy-kcal_100g': 656.25 } };
const SHAKE = { serving_size: '11 fl oz (325 mL)', serving_quantity: 325, serving_quantity_unit: 'ml',
  nutriments: { 'energy-kcal_serving': 160 } };
```

**Step 1: failing tests** — append:

```js
describe('label grams and per-100 fallback', () => {
  it('prefers the gram figure printed on the label over OFF\'s ml guess', () => {
    expect(normalizeProductNutrition(OIKOS).serving).toEqual({ size: 170, unit: 'g' });
    const cheese = normalizeProductNutrition(CHEESE);
    expect(cheese.serving).toEqual({ size: 28, unit: 'g' });
    expect(cheese.nutrition.calories).toBeCloseTo(110, 0);
  });
  it('keeps a real volume as ml', () => {
    expect(normalizeProductNutrition(SHAKE).serving).toEqual({ size: 325, unit: 'ml' });
  });
  it('falls back to the per-100 basis instead of discarding known values', () => {
    const coke = normalizeProductNutrition(DIET_COKE);
    expect(coke.serving).toEqual({ size: 100, unit: 'ml' });
    expect(coke.nutrition.calories).toBe(0);
    expect(coke.nutritionLookup.servingFallback).toBe('per100');
    const pb = normalizeProductNutrition(PEANUT_BUTTER);
    expect(pb.serving).toEqual({ size: 100, unit: 'g' });
    expect(pb.nutrition.calories).toBeCloseTo(656.25, 2);
    expect(pb.nutritionLookup.servingText).toBe('2 tbsp (2 tbsp)');
  });
});
```

**Step 2:** run → FAIL.

**Step 3: implement.** At the top of `normalizeProductNutrition`:

```js
// OFF sets serving_quantity_unit to `ml` whenever the label says "cup", even
// when the same label prints the mass: "1/4 cup (28 g)". A printed gram figure
// is the better fact. A real volume ("325 mL") has no gram figure and stays ml.
const labelGrams = text => {
  const match = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(?:g|grams?)\b/i);
  return match ? Number(match[1].replace(',', '.')) : null;
};
```

and replace the `quantity` / `unit` lines with:

```js
const printedGrams = labelGrams(product.serving_size);
let quantity = numeric(product.serving_quantity);
let unit = product.serving_quantity_unit || null;
if (printedGrams > 0 && unit !== 'g') { quantity = printedGrams; unit = 'g'; }
if (printedGrams > 0 && !(quantity > 0)) { quantity = printedGrams; unit = 'g'; }
let servingKnown = quantity > 0 && ['g', 'ml'].includes(unit);
// No usable serving, but per-100 values exist: log 100 g/ml of it rather than
// nulls. A known zero (diet soda) must stay a zero. The caller may replace the
// 100 with an estimate of the label's own serving (servingText).
let servingFallback = null;
if (!servingKnown && Object.values(fields).some(source => numeric(n[`${source}_100g`]) !== null)) {
  const liquid = product.nutrition_data_per === '100ml' || /\b(ml|l|fl\.? ?oz)\b/i.test(String(product.quantity || ''));
  quantity = 100; unit = liquid ? 'ml' : 'g'; servingKnown = true; servingFallback = 'per100';
}
```

Keep the existing `warnings.push('Serving size or unit is missing…')` but key it on
`!servingKnown || servingFallback`. In the returned `nutritionLookup` add
`servingFallback, servingText: product.serving_size || null`, and keep
`servingVerified: servingKnown && !servingFallback`.

**Step 4:** rerun → PASS (old tests too).

**Step 5:** commit `fix(nutribot): read label grams; keep per-100 values when the serving is missing`.

---

### Task B5: Label-serving estimate and classifier icon in `LogFoodFromUPC`

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
- Modify: `backend/src/1_adapters/nutribot/UPCGateway.mjs:164,204`
- Test: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.gate.test.mjs` (extend)

**Step 1: failing tests** — extend `make()` to accept `{ ai, icons }` and pass
`aiGateway: ai, foodIconsString: icons`; then:

```js
describe('LogFoodFromUPC icon and serving', () => {
  const pb = { upc: '037600225250', name: 'Peanut Butter Spread', icon: '🍽️', serving: { size: 100, unit: 'g' },
    nutrition: { calories: 656.25, protein: 25, carbs: 20, fat: 50 },
    nutritionLookup: { source: 'openfoodfacts', servingFallback: 'per100', servingText: '2 tbsp', warnings: ['x'] } };
  const ai = { chat: vi.fn(async () => '{"icon":"peanut-butter","noomColor":"orange","servingGrams":32}') };

  it('uses the classifier icon, not the gateway placeholder', async () => {
    const { uc, foodLogStore } = make(pb, { ai, icons: 'peanut-butter carrot' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    expect(foodLogStore.save.mock.calls[0][0].items[0].icon).toBe('peanut-butter');
  });

  it('scales a per-100 fallback to the classifier\'s gram estimate of the label serving', async () => {
    const { uc, foodLogStore } = make(pb, { ai, icons: 'peanut-butter' });
    await uc.execute({ userId: 'u', conversationId: 'c', upc: '037600225250', headless: true });
    const item = foodLogStore.save.mock.calls[0][0].items[0];
    expect(item.grams).toBe(32);
    expect(item.calories).toBeCloseTo(210, 0);
  });
});
```

(`037600225250` must pass `parseGtin`; if not, use any valid 12-digit code.)

**Step 2:** run → FAIL.

**Step 3: implement.**

1. `UPCGateway.mjs`: delete `icon: '🍽️',` at both lookups. A product has no
   icon until the classifier or catalog gives it one.
2. `LogFoodFromUPC.mjs` icon line (~278):
   ```js
   // Only a slug we own can outrank the classifier; the gateway used to stamp
   // every product with an emoji that won this contest and then failed it.
   const proposedIcon = this.#iconVocabulary.has(product.icon) ? product.icon : classification.icon;
   ```
3. `#classifyProduct`: when `product.nutritionLookup?.servingFallback`, append to
   the user message `\nLabel serving: ${product.nutritionLookup.servingText || 'unknown'}`
   and to the system prompt:
   `If a label serving is given, also estimate its mass in grams as "servingGrams" (number, or null if unknowable).`
   Return `parsed.servingGrams` alongside `icon`/`noomColor`.
4. After classification, before `grams` is computed:
   ```js
   // A per-100 fallback is honest but rarely the portion eaten. The classifier
   // already running for the icon also estimates the label's serving ("2 tbsp")
   // in grams; the row stays unconfirmed, so the estimate is reviewed like any other.
   const estimate = Number(classification.servingGrams);
   if (product.nutritionLookup?.servingFallback === 'per100' && product.serving?.unit === 'g' && estimate > 0 && estimate < 2000) {
     const factor = estimate / 100;
     product = { ...product, serving: { size: estimate, unit: 'g' },
       nutrition: Object.fromEntries(Object.entries(product.nutrition || {}).map(([k, v]) => [k, v == null ? null : Math.round(v * factor * 1000) / 1000])),
       nutritionLookup: { ...product.nutritionLookup, servingEstimate: { source: 'ai', grams: estimate } } };
   }
   ```
   (`product` must be a `let`; it already is reassigned in step 4 of `#execute` —
   confirm before editing.)

**Step 4:** rerun gate + catalog tests → PASS.

**Step 5:** commit `fix(nutribot): classifier icon wins over gateway placeholder; estimate label serving grams`.

---

### Task B6: Placeholder product photos

**Files:**
- Modify: `backend/src/1_adapters/nutribot/UPCGateway.mjs`
- Test: `backend/src/1_adapters/nutribot/UPCGateway.image.test.mjs` (new)

The barcodespider "image coming soon" JPEG is one fixed file for every unknown
code: 4,944 bytes, SHA-256
`ab815c08e2dae4cfb52c02471fdbcf5169c853dcfe8b0a05bc87dc877e3af055`
(verified against three unrelated codes and the nine stored copies).

**Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { UPCGateway } from './UPCGateway.mjs';

const jpeg = (tail) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.from(tail)]);
const sha = b => createHash('sha256').update(b).digest('hex');

describe('UPCGateway.fetchImage', () => {
  it('refuses a known placeholder image', async () => {
    const placeholder = jpeg('coming soon');
    const logger = { debug() {}, info: vi.fn(), warn() {}, error() {} };
    const gw = new UPCGateway({ httpClient: { downloadBuffer: vi.fn(async () => placeholder) }, logger,
      placeholderDigests: [sha(placeholder)] });
    expect(await gw.fetchImage('https://images.barcodespider.com/upcimage/1.jpg')).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('upc.image.placeholder', expect.any(Object));
  });
  it('keeps a real product image', async () => {
    const real = jpeg('a real can');
    const gw = new UPCGateway({ httpClient: { downloadBuffer: vi.fn(async () => real) }, logger: console, placeholderDigests: [] });
    expect(await gw.fetchImage('https://x/y.jpg')).toEqual(real);
  });
});
```

Check `UPCGateway`'s constructor for required deps (`httpClient`, `logger`, …)
and satisfy them in the test.

**Step 2:** run → FAIL.

**Step 3: implement.**

```js
import { createHash } from 'node:crypto';
// barcodespider answers an unknown code with one fixed "image coming soon"
// JPEG. It passes the magic-byte check, so it is refused by content.
export const PLACEHOLDER_IMAGE_SHA256 = Object.freeze([
  'ab815c08e2dae4cfb52c02471fdbcf5169c853dcfe8b0a05bc87dc877e3af055',
]);
```

Constructor: `this.#placeholderDigests = new Set(config.placeholderDigests ?? PLACEHOLDER_IMAGE_SHA256);`
In `fetchImage`, after the magic-byte check passes:

```js
const digest = createHash('sha256').update(buffer).digest('hex');
if (this.#placeholderDigests.has(digest)) {
  this.#logger.info?.('upc.image.placeholder', { url, bytes: buffer.length });
  return null;
}
```

**Step 4:** run → PASS.

**Step 5:** commit `fix(nutribot): refuse the barcodespider placeholder as a product photo`.

---

### Task B7: Product name normalization

**Files:**
- Create: `shared/contracts/health/productName.mjs`
- Test: `shared/contracts/health/productName.test.mjs`
- Modify: `backend/src/1_adapters/nutribot/UPCGateway.mjs` (both `name:` lines)

**Step 1: failing test**

```js
import { describe, it, expect } from 'vitest';
import { normalizeProductName } from './productName.mjs';

describe('normalizeProductName', () => {
  it.each([
    ['OIKOS PRO PLAIN', 'Oikos Pro Plain'],
    ['PEANUT BUTTER SPREAD', 'Peanut Butter Spread'],
    ['Galbani STRING CHEESE', 'Galbani String Cheese'],
    ['BABY SPINACH', 'Baby Spinach'],
    ['PEELED BABY-CUT CARROTS', 'Peeled Baby-Cut Carrots'],
    ['CORE POWER Chocolate High Protein Milk Shake', 'Core Power Chocolate High Protein Milk Shake'],
    ['MACARONI AND CHEESE', 'Macaroni and Cheese'],
    ['BBQ SAUCE', 'BBQ Sauce'],
    ['Kind PB Bar', 'Kind PB Bar'],
    ['McCormick Pure Vanilla', 'McCormick Pure Vanilla'],
    ['Sharp Cheddar Cheddar Cheese', 'Sharp Cheddar Cheese'],
    ['  Diet coca cola ', 'Diet coca cola'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeProductName(raw)).toBe(expected);
  });
});
```

**Step 2:** `npx vitest run shared/contracts/health/productName.test.mjs` → FAIL.

**Step 3:** `productName.mjs`

```js
/**
 * Product names arrive from barcode databases as printed on the pack, often in
 * capitals ("OIKOS PRO PLAIN"). Normalize ONCE at ingest, before the catalog and
 * the ledger see them. Only shouting is changed: mixed-case words ("McCormick")
 * and short acronyms inside a mixed name ("PB") are the brand's own spelling.
 */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const ACRONYMS = new Set(['BBQ', 'BLT', 'USA', 'XL', 'PB', 'PBJ', 'GF', 'DHA', 'UHT', 'OJ']);
const letters = word => word.replace(/[^A-Za-z]/g, '');
const shouting = word => letters(word).length > 0 && letters(word) === letters(word).toUpperCase();
const titleWord = word => word.toLowerCase().replace(/(^|[-/(])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());

export function normalizeProductName(raw) {
  const words = String(raw ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const wholeNameShouts = words.every(w => !letters(w) || shouting(w));
  const cased = words.map((word, index) => {
    if (!shouting(word) || ACRONYMS.has(letters(word))) return word;
    if (!wholeNameShouts && letters(word).length < 4) return word;
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return titleWord(word);
  });
  return cased.filter((word, index) => index === 0 || word.toLowerCase() !== cased[index - 1].toLowerCase()).join(' ');
}
```

**Step 4:** run → PASS. Then in `UPCGateway.mjs`:
`import { normalizeProductName } from '#shared/contracts/health/productName.mjs';` and
`name: normalizeProductName(p.product_name || p.product_name_en) || 'Unknown Product',` (OFF),
`name: normalizeProductName(food.food_name) || 'Unknown Product',` (Nutritionix).
Rerun `UPCGateway.image.test.mjs` and the gate tests.

**Step 5:** commit `feat(health): normalize shouting product names at barcode ingest`.

---

### Task B8: Only offered (hi-res) icons propagate from the catalog

**Files:**
- Modify: `backend/src/3_applications/health/FoodCatalogService.mjs:68-76,423-434`
- Modify: `backend/src/5_composition/bootstrap.mjs:2423-2430`
- Test: `backend/src/3_applications/health/FoodCatalogService.icon.test.mjs` (extend)

The hi-res manifest is the exclusive icon set. Old catalog entries carry the
retired 20 px vocabulary (`cheese`, `pitasandwich`, `ranch_dressing` — 186
entries), and `resolveIdentity` copies them onto new rows ahead of the capture's
own hi-res icon. After this task a catalog icon — learned or pinned — is used
only when the manifest OFFERS it.

**Step 1: failing tests** — read the file's existing construction helper, then add:

```js
describe('resolveIdentity icon precedence', () => {
  const offered = new Set(['feta-cubes', 'pita-bread']);
  const svc = (entry) => new FoodCatalogService({
    catalogStore: { findByNormalizedName: async () => entry, getById: async () => entry },
    clock: { now: () => 0 }, createId: () => 'id',
    iconOffered: slug => offered.has(slug),
  });
  it('a retired catalog icon does not override the capture\'s icon', async () => {
    const out = await svc({ id: 'f', icon: 'cheese' }).resolveIdentity({ name: 'Feta Cheese', icon: 'feta-cubes' }, 'u');
    expect(out.icon).toBe('feta-cubes');
  });
  it('an offered catalog icon still wins', async () => {
    const out = await svc({ id: 'f', icon: 'pita-bread' }).resolveIdentity({ name: 'Pita Bread', icon: 'default' }, 'u');
    expect(out.icon).toBe('pita-bread');
  });
  it('an offered pin wins over the learned icon; a retired pin does not', async () => {
    expect((await svc({ id: 'f', icon: 'feta-cubes', iconOverride: 'pita-bread' })
      .resolveIdentity({ name: 'Pita', icon: 'default' }, 'u')).icon).toBe('pita-bread');
    expect((await svc({ id: 'f', icon: 'x', iconOverride: 'pitasandwich' })
      .resolveIdentity({ name: 'Pita', icon: 'pita-bread' }, 'u')).icon).toBe('pita-bread');
  });
});
```

**Step 2:** `npx vitest run backend/src/3_applications/health/FoodCatalogService.icon.test.mjs` → FAIL.

**Step 3: implement.**

Constructor accepts an optional predicate (default: accept everything, so every
existing construction keeps its behaviour):

```js
this.#iconOffered = typeof iconOffered === 'function' ? iconOffered : () => true;
```

`resolveIdentity`'s entry branch:

```js
if (!entry) return { ...item, foodId };
// The hi-res manifest is the only icon set. A catalog icon from the retired
// flat vocabulary, pinned or learned, never reaches a new row.
const usable = slug => isRealIcon(slug) && this.#iconOffered(slug);
const icon = [entry.iconOverride, entry.icon].find(usable) || item.icon;
return { ...item, foodId: entry.id, icon };
```

Also guard `setIcon(id, userId, icon)` (L461): refuse a non-offered, non-null
slug with a 400-style error (`code: 'ICON_NOT_OFFERED'`); add a test.

`bootstrap.mjs`, in `createHealthServices` before `catalogService`:

```js
// The catalog needs the manifest's offered (hi-res) vocabulary. Built fail-soft
// like nutribot's own store: no media root, no filtering.
const catalogIcons = configService?.getMediaDir
  ? new IconManifestStore({ dataService, mediaRoot: configService.getMediaDir(), logger })
  : null;
```

and pass `iconOffered: catalogIcons ? slug => catalogIcons.list().includes(slug) : null,`
to `new FoodCatalogService({...})`. (`IconManifestStore` is already imported in
bootstrap; `list()` loads once.)

**Step 4:** rerun all `FoodCatalogService.*.test.mjs` → PASS;
`npm run test:composition-contracts` → PASS.

**Step 5:** commit `fix(health): only offered hi-res icons propagate from the food catalog`.

---

### Task B9: Hi-res icons are the exclusive set

Verified 2026-09-22: the installed manifest (534 icons, 21 aliases) already
points only at hi-res art (`img/nutrition/icons/**`); every alias maps an old
name to a hi-res file. The 20 px flat set (`img/icons/food/*.png`) is not in it.
This task keeps it that way and moves stored data off the retired names.

**Files:**
- Modify: `cli/curate-nutrition-icons.mjs:128-150` (+ new `cli/curate-nutrition-icons.test.mjs`)
- Modify: `backend/src/1_adapters/persistence/IconManifestStore.mjs` `#load` (+ its test)
- Create: `cli/health-icon-manifest-merge.cli.mjs` (+ test) — `foodNames` only
- Create: `docs/_wip/plans/2026-09-22-icon-reassignment.yml` (reviewed data)

**B9a — curation stops proposing flat art.** In `buildManifest`, a flat legacy
file whose hyphenated slug has no hi-res counterpart is no longer aliased to the
flat file (delete the `else` branch at ~L146-149); count it in
`aliasReport.retired` and list it in the report instead. Update the header
comment ("must keep resolving forever" → retired names are re-iconed by data
repair, never served). Test: call the exported `buildManifest` (read its
signature and input shape first) with one hi-res file `bakery/pita-bread.png`
and flat files `pita_bread.png`, `pitasandwich.png`; expect `aliases.pita_bread`
→ the hi-res path, no `aliases.pitasandwich`, and `report.aliasReport.retired === 1`.

**B9b — the store refuses flat art at runtime.** In `IconManifestStore#load`,
drop any `icons` or `aliases` entry whose `path` starts with `img/icons/food/`
and log `health.icons.manifest.retired_art_dropped { count, slugs }` at warn.
Test in `IconManifestStore.test.mjs` style: a manifest with one hi-res icon and
one flat-path alias → `has(flatAlias) === false`, `resolve(flatAlias) === null`,
warn logged. This makes a hand-edited manifest unable to bring the 20 px set
back.

**B9c — reviewed food names.** `mergeFoodNames(installed, foodNames)` adds the
reviewed map to the manifest's `foodNames`, refusing any slug not in `icons`
(test: accepted slug added; unknown slug throws naming it; `icons` and `aliases`
untouched). CLI: `--manifest PATH --food-names PATH [--apply --backup NEW_PATH]`;
dry run prints additions; `--apply` copies the manifest to `--backup`
(`COPYFILE_EXCL`), writes with `saveYamlToPathAtomic`, re-reads and checks icon
and alias counts unchanged. The map, `docs/_wip/plans/2026-09-22-icon-food-names.yml`
(every target verified installed):

```yaml
pita bread: pita-bread
feta cheese: feta-cubes
sharp cheddar cheese: cheddar-wedge
baby spinach: spinach
diet coca cola: cola
diet coke: cola
peeled baby-cut carrots: carrot
shredded carrots: carrot
peanut butter spread: peanut-butter
chicken fried rice: fried-rice
```

**B9d — reassignment table for stored retired names.** A name→slug table for
every catalog entry and ledger row (hot and archives) whose icon is neither
`default` nor offered. Generic retired slugs (`cheese`, `chicken`, `sauce`) have
no single hi-res equivalent, so assignment is by FOOD NAME, exactly as a new
capture would choose:

1. Script (scratch, not committed): list distinct `(name, retired slug, count)`
   from `food_catalog.yml`, `nutrilist.yml` and `archives/nutrilist/*.yml`.
2. For each name: the B9c `foodNames` entry if present; otherwise pick the best
   slug from the installed `icons` list by name (the executing agent does this,
   viewing the candidate PNGs under `media/img/nutrition/icons/` with the Read
   tool where two candidates are close); otherwise `default`. Never an alias,
   never a flat-set slug.
3. Write `docs/_wip/plans/2026-09-22-icon-reassignment.yml` as
   `{ "<normalized name>": "<slug|default>" }` with a comment giving the old slug
   and count per line. **Show it to the user for review before B10 applies it.**

**Commits:** one per sub-task (`fix(icons): curation never proposes flat art`,
`fix(icons): manifest store refuses flat-art entries`,
`feat(health): reviewed food-name icons merge`, `docs(health): icon reassignment table`).
Running the B9c `--apply` needs the user's go-ahead (live household data;
backend restart to load).

---

### Task B10: Repair existing ledger rows and catalog names

**Files:**
- Create: `backend/src/3_applications/health/ScanDataRepair.mjs` (+ `ScanDataRepair.test.mjs`)
- Create: `cli/health-scan-repair.cli.mjs`

A pure planner over NutriList rows, applied through
`YamlNutriListDatastore.mutateEntries` exactly like `cli/health-group-repair.cli.mjs`
(inventory hash → report → `--apply` with verified backup → `--offline` required
→ verify after).

**Planner contract** — `planScanDataRepair(rows, { placeholderPhotoRefs, labelGrams, iconByName, offered, deleteIds })`
(`iconByName` = the B9c food names merged with the reviewed B9d table; `offered` = the manifest's `icons` keys)
returns `{ deleteIds, updates, report }`:

| Rule | Selects | Change |
|---|---|---|
| Re-fire duplicates | `review.source === 'upc'` rows with the same `date`, `mealTime`, `item`, `calories` as an earlier such row whose `review.startedAt` is ≤ 30 s before | delete |
| Explicit deletes | ids passed in `deleteIds` (from the report's `emptyUpc` list, chosen by a person) | delete |
| Placeholder photos | `photoRef` in `placeholderPhotoRefs` | `photoRef: null` |
| Shouting names | `review.source === 'upc'`, `normalizeProductName(item) !== item`, `name` not in `manualFields` | `name: normalized` |
| Mislabelled ml | `unit === 'ml'`, `item` in `labelGrams`, `originalQuantity.amount > 0` | `grams = amount × labelGrams[item] / originalQuantity.amount`, `unit: 'g'`, `amount: grams` |
| Retired icons | `icon` neither `default` nor in `offered` (includes the literal `🍽️`) | `icon: iconByName[normalized item] ?? 'default'` |
| Reviewed food names | normalized `item` in `iconByName`, current icon offered but different | `icon: iconByName[name]` |

The report also lists (never changes) `emptyUpc`: UPC rows where every nutrient
is null (Magazine, Peanut Butter Spread, Winco Foods). Real foods among them are
left for a person to correct in the app.

Each update carries the row's `expectedVersion`. The test uses fixture rows built
from the audit (six "Magazine" rows 1–3 s apart, two Strawberry Milkshake rows
0.4 s apart, OIKOS at 170 ml, one all-caps name with `manualFields: ['name']`
that must NOT be renamed, one placeholder photoRef) and asserts the exact
`deleteIds` and `updates`. Placeholder photoRefs are found by the CLI (hash every
`photos/*.jpg` against `PLACEHOLDER_IMAGE_SHA256`), not the planner.

Catalog icons: entries whose `icon` or `iconOverride` is not offered get `icon: iconByName[name] ?? 'default'` and a non-offered `iconOverride` cleared, written through the catalog datastore's `save`.

Catalog names: the CLI also plans `FoodCatalogService.updateDefinition(id, userId, { name })`
for entries whose `name` normalizes differently. It skips (and reports) any that
would 409 on a duplicate name. Construct the catalog datastore the way the
ledger repair constructs `YamlNutriListDatastore` (read `YamlFoodCatalogDatastore`'s
`#loadCatalog`/`#saveCatalog` for the `dataService` calls to stub).

`labelGrams` for the run: `{"OIKOS PRO PLAIN":170,"Mexican Style 4 Cheese Blend":28,"Premium Kidney Beans":130}`
(from the OFF `serving_size` strings in the audit). Add `Spring Mix` only after
confirming its OFF `serving_size` prints grams.

**Steps:** TDD the planner (failing test → implement → pass → commit), then the
CLI (dry run prints `{deletes, updates, emptyUpc, catalogRenames}`; commit).

**Running it** follows `docs/runbooks/health-ledger-repair.md`: nutrition writers
stopped (prod container included, since prod and this laptop share the Dropbox
data tree), `--offline`, backup outside the tree. **Show the user the dry-run
report and get a go-ahead before `--apply`**; this rewrites the live ledger.

In the same stopped-writers window, move the abandoned
`food_catalog.yml.tmp-*` (2026-09-11, next to the live catalog) into the
nutrition directory's `_backups/`; confirm first that no process holds it
(`lsof`) and that its mtime is older than the live `food_catalog.yml`.

---

### Task B11: Docs

- `docs/reference/health/README.md` — capture funnels: barcode intake gate
  (check digit, doubled reads, ISBN refusal, 30 s repeat window per reader),
  quarantine of nutrition-less scans to Needs Review, label-gram and per-100
  rules, placeholder refusal, name normalization.
- `docs/reference/health/data-pipeline.md` — the same, where the UPC pipeline is
  described (grep `UPC`).
- `docs/runbooks/health-ledger-repair.md` — add `health-scan-repair.cli.mjs` and
  `health-icon-manifest-merge.cli.mjs` usage.
- `docs/reference/health/README.md` — icons: the hi-res manifest is the only
  set; flat-path entries are dropped at load; retired names on old rows are
  re-iconed by repair, not aliased.
- Audit doc: mark findings fixed with commit hashes.

**Commit:** `docs(health): barcode intake gate, quarantine, icon aliases, repairs`.

---

## Deploy notes (after merge)

- Frontend and backend ship together; no config changes.
- The food-name merge (B9c) and ledger/catalog repair (B10, using the reviewed
  B9d table) are data operations run once, with the user's go-ahead, in that order. `IconManifestStore` caches the
  manifest: the backend must restart after B9c for the food names to load.
