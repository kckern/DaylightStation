import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
const departureState = vi.hoisted(()=>({departed:false}));
// The latest props the BarcodeCapture stub received, so a test can drive a decode.
const barcodeProps = vi.hoisted(() => ({ current: null }));
const customFoodProps = vi.hoisted(() => ({ current: null }));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Bypass the real file-picker/FileReader and MediaRecorder plumbing — the
// thing under test is TodayView's handling of the /nutrition/input response,
// not the capture widgets themselves (those have their own tests).
//
// Each meal's add row mounts one PhotoCapture/VoiceCapture, and every meal
// always renders, so there is exactly one of each per bucket. The mock label
// carries the received `bucket` so each instance stays individually
// clickable/assertable.
vi.mock("../capture/PhotoCapture.jsx", () => ({
  PhotoCapture: ({ onCapture, bucket }) => (
    <button onClick={() => onCapture('data:image/png;base64,zzz', bucket)}>
      {bucket ? `MockPhotoCapture-${bucket}` : 'MockPhotoCapture'}
    </button>
  ),
}));
vi.mock("../capture/VoiceCapture.jsx", () => ({
  VoiceCapture: ({ onCapture, bucket }) => (
    <><button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>
      {bucket ? `MockVoiceCapture-${bucket}` : 'MockVoiceCapture'}
    </button><button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket, { departed:true }).catch(()=>{})}>
      MockDepartedVoiceCapture-{bucket}
    </button><button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket, { isDeparted:()=>departureState.departed }).catch(()=>{})}>
      MockPendingVoiceCapture-{bucket}
    </button></>
  ),
}));
vi.mock("../capture/BarcodeCapture.jsx", () => ({ BarcodeCapture: (props) => { barcodeProps.current = props; return null; } }));
vi.mock("../capture/CustomFoodSheet.jsx", () => ({ CustomFoodSheet: (props) => { customFoodProps.current = props; return null; } }));
// Pin the capture-pending bucket target so the "which bucket does the
// placeholder land in" tests are deterministic regardless of wall-clock
// time — everything else in mealBuckets.js (BUCKETS, localTodayISO, …)
// stays real.
vi.mock("./mealBuckets.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, currentMealBucketId: () => 'afternoon' };
});

import { MemoryRouter } from 'react-router-dom';
import { TodayView } from "./TodayView.jsx";
import { localTodayISO } from "./mealBuckets.js";
import { addDaysISO } from "./moveDays.js";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

function r(ui) { return render(<MemoryRouter><MantineProvider>{ui}</MantineProvider></MemoryRouter>); }

const NUTRILIST = { data: [] };
const BUDGET = { budget: 2000, food: 0, exercise: 0, remaining: 2000, status: 'under', sessions: [] };
const DASHBOARD = { today: { coaching: [] } };

const baseApi = (overrides = {}) => async (path) => {
  if (path.includes('nutrition/observations')) return overrides.observations ?? { observations: [] };
  if (path.includes('health/day?')) return { items: NUTRILIST.data, budget: BUDGET };
  if (path.includes('budget')) return BUDGET;
  if (path.includes('dashboard')) return DASHBOARD;
  if (path.includes('nutrition/pending')) return overrides.pending ?? { pending: [] };
  if (path.includes('nutrition/input')) return overrides.nutritionInput ?? {};
  return {};
};

// Captures are committed on arrival (Task 1.1): a successful photo/voice
// submit already logged the row(s) as accepted+unsettled — there is no
// review phase, no PendingConfirmCard, and no Undo/Accept/Done affordance
// here. The day reload picks the new unsettled rows up via LogTable/EntryRow.
describe('TodayView — photo/voice capture: no review phase, day reload instead (I-4 follow-up)', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('an image submit whose response carries choices (food detected) reloads the day and renders no review card', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: {
        committed: true,
        messages: [{
          text: 'Grilled chicken — 350 kcal',
          choices: [[
            { text: '↩️ Undo', callback_data: '{"cmd":"x","id":"log-1"}' },
            { text: '✏️ Edit', callback_data: '{"cmd":"r","id":"log-1"}' },
          ]],
        }],
      },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning')); // Breakfast's per-meal trigger
    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByText('MockPhotoCapture-morning'));

    // day.reload() re-fetches nutrilist+budget — no card ever mounts to wait on.
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore + 1));

    expect(document.querySelector('.health-pending')).toBeFalsy();
    expect(document.querySelector('.ds-toast')).toBeFalsy();
    expect(screen.queryByText(/350 kcal/)).toBeFalsy();
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull();
  });

  it('an image submit with no food detected surfaces the message instead of silence, and is dismissible', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { messages: [{ text: "I couldn't identify any food in this image." }] },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning')); // Breakfast's per-meal trigger
    fireEvent.click(screen.getByText('MockPhotoCapture-morning'));

    await waitFor(() => expect(screen.getByText(/couldn't identify/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /accept/i })).toBeFalsy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/couldn't identify/i)).toBeFalsy();
  });

  it('shows pending logs from every capture surface', async () => {
    apiMock.mockImplementation(baseApi({
      pending: {
        pending: [
          { id: 'log-1', source: 'telegram', items: [{ label: 'Oatmeal', calories: 210 }] },
          { id: 'log-2', source: 'scale', items: [{ label: 'Chicken breast', calories: 231 }] },
          { id: 'log-3', source: 'web', items: [{ label: 'Apple', calories: 95 }] },
          { id: 'log-4', source: 'scanner', items: [{ label: 'Shake', calories: 160 }] },
        ],
      },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(screen.getByText('Oatmeal')).toBeTruthy();
    expect(screen.getByText('Apple')).toBeTruthy();
    expect(screen.getByText('Shake')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Review food$/ })).toHaveLength(4);
  });

  it('confirms a Telegram barcode entry in Health and refreshes the pending list and day', async () => {
    let accepted = false;
    const pending = { id: 'barcode-log', version: 'v1', date: '2026-09-06',
      source: 'telegram', mealTime: 'afternoon',
      items: [{ id: 'shake-item', label: 'Salted Caramel Protein Shake', calories: 160 }] };
    apiMock.mockImplementation(async (path, body, method) => {
      if (path.endsWith('nutrition/pending/barcode-log/review') && method === 'POST') {
        expect(body.action).toBe('confirm');
        accepted = true;
        return { logged: true, messages: [] };
      }
      if (path.includes('nutrition/pending')) return { pending: accepted ? [] : [pending] };
      if (path.includes('health/day?')) return {
        items: accepted ? [{ uuid: 'shake-row', name: 'Salted Caramel Protein Shake',
          calories: 160, mealTime: 'afternoon' }] : [],
        budget: { ...BUDGET, food: accepted ? 160 : 0, remaining: accepted ? 1840 : 2000 },
      };
      return baseApi()(path);
    });
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Review food$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm food' }));
    await waitFor(() => {
      expect(screen.queryByText('NEEDS REVIEW')).toBeNull();
      expect(document.querySelector('.health-row__name')?.textContent).toBe('Salted Caramel Protein Shake');
      expect(screen.getByTestId('budget-headline')).toHaveTextContent('1,840 kcal left');
    });
  });
});

const NUTRILIST_WITH_ROW = { data: [{ uuid: 'r1', name: 'Bagel', calories: 300, mealTime: 'morning' }] };
const NUTRILIST_WITH_TWO_ROWS = {
  data: [
    { uuid: 'r1', name: 'Bagel', calories: 300, mealTime: 'morning' },
    { uuid: 'r2', name: 'Toast', calories: 120, mealTime: 'morning' },
  ],
};

describe('TodayView — Task 3.2: permanent chrome, SWR day data, in-place capture pending', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('renders the Lunch and Dinner headings during a true cold load, with the shimmer confined to section bodies', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('health/day?')) return new Promise(() => {}); // never resolves — stay cold
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    // Synchronously, before anything resolves: structure is already there.
    // All four meals are permanent.
    for (const meal of ['Breakfast', 'Lunch', 'Dinner', 'Snacks']) expect(screen.getByText(meal)).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: /^Add to / }).length).toBe(4);
    // The shimmer lives INSIDE a section body, not as a page-level spinner.
    const shimmers = screen.getAllByLabelText(/^Loading /);
    expect(shimmers.length).toBeGreaterThan(0);
    for (const shimmer of shimmers) expect(shimmer.closest('section')).toBeTruthy();
  });

  it('a cached day renders immediately on mount with no shimmer and rows already present (SWR cache hit)', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('health/day?')) return { items: NUTRILIST_WITH_ROW.data, budget: BUDGET };
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      return {};
    });

    const first = r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bagel')).toBeTruthy());
    first.unmount();

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    // No waitFor: this must already be true on first paint of the remount.
    expect(screen.getByText('Bagel')).toBeTruthy();
    expect(screen.queryByLabelText(/^Loading /)).toBeNull();
  });

  it('a mutation-triggered day.reload() shows no shimmer at any point across the update (regression: onDiscard -> reload, I-4)', async () => {
    let phase = 'initial';
    let resolveReload;
    apiMock.mockImplementation(async (path) => {
      if (path.includes('nutrition/callback')) return { ok: true };
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) {
        return phase === 'initial'
          ? { pending: [{ id: 'log-9', source: 'scale', items: [{ label: 'Chicken breast', calories: 231 }] }] }
          : { pending: [] };
      }
      if (path.includes('health/day?')) {
        // Only the VIEWED day's reload hangs. Neighbour-day prefetch also asks
        // for health/day, and must not take over the resolver.
        if (phase === 'initial' || !path.includes(`date=${viewed}`)) return { items: NUTRILIST_WITH_ROW.data, budget: BUDGET };
        return new Promise((res) => { resolveReload = () => res({ items: NUTRILIST_WITH_TWO_ROWS.data, budget: BUDGET }); });
      }
      return {};
    });
    const viewed = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, as TodayView defaults to

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bagel')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy()); // NeedsReviewSection mounted
    expect(screen.queryByLabelText(/^Loading /)).toBeNull();

    phase = 'reload';
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    // Mid-flight (the reload's nutrilist fetch is deliberately hanging):
    // the previously-loaded row is still shown, structure intact, no shimmer.
    await waitFor(() => expect(resolveReload).toBeTruthy());
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Bagel')).toBeTruthy();
    expect(screen.queryByLabelText(/^Loading /)).toBeNull();

    resolveReload();
    await waitFor(() => expect(screen.getByText('Toast')).toBeTruthy());
    expect(screen.queryByLabelText(/^Loading /)).toBeNull();
  });

  it('the Exercise header renders with zero sessions once budget data has loaded', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('health/day?')) return { items: NUTRILIST.data, budget: BUDGET };
      if (path.includes('budget')) return BUDGET; // sessions: []
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Exercise' })).toBeTruthy());
  });

  it('shows an in-place "Analyzing…" placeholder in the target bucket while a capture is in flight, cleared once the result lands', async () => {
    let resolveInput;
    apiMock.mockImplementation(async (path) => {
      if (path.includes('health/day?')) return { items: NUTRILIST.data, budget: BUDGET };
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      if (path.includes('nutrition/input')) return new Promise((res) => { resolveInput = res; });
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    // Lunch's own per-meal trigger — explicitly targets bucket 'afternoon'.
    await waitFor(() => screen.getByText('MockPhotoCapture-afternoon'));
    fireEvent.click(screen.getByText('MockPhotoCapture-afternoon'));

    await waitFor(() => expect(screen.getByText('Analyzing…')).toBeTruthy());
    const placeholder = screen.getByText('Analyzing…');
    expect(placeholder.closest('[aria-busy="true"]')).toBeTruthy();
    const lunchSection = screen.getByText('Lunch').closest('section');
    expect(lunchSection.contains(placeholder)).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Add to Dinner' })).toBeTruthy();

    resolveInput({ messages: [] });
    await waitFor(() => expect(screen.queryByText('Analyzing…')).toBeNull());
  });
});

describe('TodayView — Task 4.2: per-meal capture buttons + the moved cue', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('tapping the mic on a given meal section submits with THAT bucket, not the clock guess', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { messages: [] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    // LogTable mounts one VoiceCapture per bucket — Lunch's is labeled
    // 'MockVoiceCapture-afternoon' by the mock above.
    await waitFor(() => screen.getByText('MockVoiceCapture-afternoon'));
    fireEvent.click(screen.getByText('MockVoiceCapture-afternoon'));

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path]) => String(path).includes('nutrition/input'));
      expect(call).toBeTruthy();
      expect(call[1]).toEqual(expect.objectContaining({ bucket: 'afternoon' }));
    });
  });

  it('tapping the camera on a DIFFERENT meal section submits with that section\'s own bucket', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { messages: [] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-evening')); // Dinner
    fireEvent.click(screen.getByText('MockPhotoCapture-evening'));

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path]) => String(path).includes('nutrition/input'));
      expect(call).toBeTruthy();
      expect(call[1]).toEqual(expect.objectContaining({ bucket: 'evening' }));
    });
  });

  it('a response with moved:true shows the moved-to cue naming the RESOLVED meal, reusing the existing captureNotice banner', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { moved: true, mealTime: 'afternoon', messages: [] },
    }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning'));
    fireEvent.click(screen.getByText('MockPhotoCapture-morning'));

    await waitFor(() => expect(screen.getByText('Moved to Lunch')).toBeTruthy());
    // It floats in the toast region, OUT of the day's flow: a notice arriving
    // must not push the meals down the page.
    const toast = screen.getByText('Moved to Lunch').closest('.ds-toast');
    expect(toast).toBeTruthy();
    expect(toast.closest('.health-today')).toBeNull();
  });

  it('a response WITHOUT moved shows no moved-to cue', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { messages: [{ text: 'Eggs — 140 kcal', choices: [[{ text: 'Undo', callback_data: '{}' }]] }] },
    }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning'));
    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByText('MockPhotoCapture-morning'));

    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByText(/^Moved to/)).toBeNull();
  });
});

describe('TodayView — capture lives only in the meal add rows', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('renders no page-level capture bar and no footer capture controls', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('Lunch'));
    expect(screen.queryByRole('textbox', { name: 'Capture meal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Quick add to/ })).toBeNull();
    // No BARE (bucket-less) capture trigger exists anywhere — every mocked
    // instance carries a `-{bucket}` suffix, i.e. came from a meal's add row.
    expect(screen.queryByText('MockPhotoCapture')).toBeNull();
    expect(screen.queryByText('MockVoiceCapture')).toBeNull();
    expect(document.querySelector('.health-footer__actions')).toBeFalsy();
  });
});

// ===========================================================================
// Task 5.4 — kitchen-scale observations on the day.
// ===========================================================================
describe('TodayView — scale observations', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  const OPEN_WEIGHT = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    kind: 'weight', value: 82, unit: 'g', scaleId: 'kitchen-1',
    at: '2026-09-02 18:04:12', date: '2026-09-02', status: 'open', pairedEntryUuid: null,
  };
  const CONSUMED_WEIGHT = {
    ...OPEN_WEIGHT, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    value: 213, at: '2026-09-02 18:06:00', status: 'consumed', pairedEntryUuid: 'row-1',
  };
  const EARLIER_CONSUMED = {
    ...CONSUMED_WEIGHT, id: 'cccccccc-dddd-eeee-ffff-000000000000',
    value: 82, at: '2026-09-02 18:04:12',
  };

  const withRows = (rows, observations) => async (path) => {
    if (String(path).includes('nutrition/observations')) return { observations };
    if (String(path).includes('health/day?')) return { items: rows, budget: BUDGET };
    if (String(path).includes('budget')) return BUDGET;
    if (String(path).includes('dashboard')) return DASHBOARD;
    if (String(path).includes('nutrition/pending')) return { pending: [] };
    return {};
  };

  it('an unmatched observation renders as a compact row with a dismiss affordance', async () => {
    apiMock.mockImplementation(baseApi({ observations: { observations: [OPEN_WEIGHT] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    // Unclaimed readings live behind the follow-ups bell, in its sheet.
    fireEvent.click(await screen.findByRole('button', { name: /1 scale reading/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /1 scale reading to match/ }));

    await waitFor(() => expect(screen.getByText('82 g on the kitchen scale at 18:04')).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Unmatched scale measurements' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Dismiss 82 g on the kitchen scale/ })).toBeTruthy();
  });

  it('a CONSUMED observation is not in the unmatched list — it became the entry\'s badge instead', async () => {
    apiMock.mockImplementation(withRows(
      [{ uuid: 'row-1', name: 'Chili', calories: 300, mealTime: 'evening' }],
      [CONSUMED_WEIGHT],
    ));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByTitle('213 g · scale ✓')).toBeTruthy());
    expect(document.querySelector('.health-obs')).toBeFalsy();
  });

  it('an entry with SEVERAL consumed weights badges the LATEST one, not the first or a sum', async () => {
    apiMock.mockImplementation(withRows(
      [{ uuid: 'row-1', name: 'Chili', calories: 300, mealTime: 'evening' }],
      [EARLIER_CONSUMED, CONSUMED_WEIGHT],
    ));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByTitle('213 g · scale ✓')).toBeTruthy());
    expect(screen.queryByText('82 g · scale ✓')).toBeNull();
    expect(screen.queryByText('295 g · scale ✓')).toBeNull();
  });

  it('dismissing an unmatched row POSTs the dismiss endpoint and reloads the observations', async () => {
    apiMock.mockImplementation(baseApi({ observations: { observations: [OPEN_WEIGHT] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /1 scale reading/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /1 scale reading to match/ }));
    await waitFor(() => screen.getByRole('button', { name: /^Dismiss 82 g/ }));

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss 82 g/ }));

    await waitFor(() => expect(apiMock.mock.calls.some(
      ([path, , method]) => String(path).endsWith(`observations/${OPEN_WEIGHT.id}/dismiss`) && method === 'POST',
    )).toBe(true));
  });

  it('a day with no observations renders no section at all', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('Lunch'));
    expect(document.querySelector('.health-obs')).toBeFalsy();
  });

  // ---- No-regression guards for the day-view behaviours this task edits ----

  it('shows pending food from other sources alongside scale observations', async () => {
    apiMock.mockImplementation(baseApi({
      observations: { observations: [OPEN_WEIGHT] },
      pending: {
        pending: [
          { id: 'log-1', source: 'telegram', items: [{ label: 'Oatmeal', calories: 210 }] },
          { id: 'log-2', source: 'scale', items: [{ label: 'Chicken breast', calories: 231 }] },
        ],
      },
    }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText(/captures? not counted · Review/)).toBeTruthy());
    expect(screen.getByText('Chicken breast')).toBeTruthy();
    expect(screen.getByText('Oatmeal')).toBeTruthy();
  });

  it('REGRESSION: the unsettled cue stays gated strictly on settled === false', async () => {
    apiMock.mockImplementation(withRows([
      { uuid: 'row-1', name: 'Legacy', calories: 100, mealTime: 'morning' },                  // key absent
      { uuid: 'row-2', name: 'Confirmed', calories: 100, mealTime: 'morning', settled: true },
      { uuid: 'row-3', name: 'Guessed', calories: 100, mealTime: 'morning', settled: false },
    ], []));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText('Guessed')).toBeTruthy());
    expect(screen.queryByText(/estimated/i)).toBeNull();
    expect(document.querySelectorAll('.health-row-line--unsettled')).toHaveLength(1);
    expect(screen.getByText('Guessed').closest('.health-row-line')).toHaveClass('health-row-line--unsettled');
  });

  it('REGRESSION: bucket kcal totals still sum every row unconditionally (a group carries zero)', async () => {
    apiMock.mockImplementation(withRows([
      { uuid: 'g1', name: 'Curry', calories: 0, kind: 'group', mealTime: 'evening' },
      { uuid: 'c1', name: 'Rice', calories: 200, parentId: 'g1', mealTime: 'evening' },
      { uuid: 'c2', name: 'Sauce', calories: 130, parentId: 'g1', mealTime: 'evening' },
    ], []));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText('Curry')).toBeTruthy());
    expect(screen.getByText('Curry').closest('section').querySelector('.health-meal__kcal').textContent).toBe('330 kcal');
    // Group rendering intact: collapsed, with an expand control, children hidden.
    expect(screen.getByRole('button', { name: 'Collapse Curry' })).toBeTruthy();
    expect(screen.getByText('Rice')).toBeTruthy();
  });

  // Guards the PER-MEAL capture controls LogTable renders — the surface this
  // task's new section sits directly above.
  it('REGRESSION: the per-meal capture buttons still render alongside the new section', async () => {
    apiMock.mockImplementation(baseApi({ observations: { observations: [OPEN_WEIGHT] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByRole('combobox', { name: 'Add to Dinner' }));
    // Dinner's add row carries its own photo / barcode / saved-meals trio.
    expect(screen.getByText('MockPhotoCapture-evening')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan barcode to Dinner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved meals for Dinner' })).toBeTruthy();
    // An empty Breakfast still renders, as its header and add row.
    expect(screen.getByRole('button', { name: 'Scan barcode to Breakfast' })).toBeTruthy();
  });

  it('choosing the meal the ticked food is already in says so and keeps the tick', async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const eggs = { uuid: 'eggs', name: 'Eggs', date, mealTime: 'morning', calories: 90, grams: 50, version: 1 };
    const api = baseApi({});
    apiMock.mockImplementation(async (path, ...rest) => (path.includes('health/day?') ? { items: [eggs], budget: BUDGET } : api(path, ...rest)));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select foods' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Eggs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 selected to a meal' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Breakfast' }));
    expect(await screen.findByText('Already in Breakfast')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select Eggs' }).checked).toBe(true);
    expect(apiMock.mock.calls.some(([path]) => path.includes('foods-move'))).toBe(false);
  });

  it('every meal renders its add row even when empty, and none grabs focus', async () => {
    apiMock.mockImplementation(baseApi({}));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    for (const meal of ['Breakfast', 'Lunch', 'Dinner', 'Snacks']) {
      expect(await screen.findByRole('combobox', { name: `Add to ${meal}` })).toBeTruthy();
    }
    expect(document.activeElement?.getAttribute('role')).not.toBe('combobox');
  });
});

// PRD F6.3 makes the template picker the ONLY surface that lists kept meals.
// Every path that saves one therefore has to write a TEMPLATE — a saved meal
// written from here would land in a file nothing renders. That is the specific
// stranding the parity check for retiring `SavedMealsSheet` had to rule out,
// so it is pinned here rather than left to the review.
describe('TodayView — saving a meal writes a template, and the picker is the one surface', () => {
  const ROWS = { data: [
    { uuid: 'r1', id: 'r1', item: 'Eggs', name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10,
      date: '2026-09-04', mealTime: 'morning', kind: 'item', color: 'green', grams: 100, unit: 'g', amount: 100 },
  ] };
  const dayApi = (overrides = {}) => async (path, body, method) => {
    if (path.includes('health/day?')) return { items: ROWS.data, budget: BUDGET };
    return baseApi(overrides)(path, body, method);
  };

  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('"Save as meal" POSTs a template with all-core components, not a saved meal', async () => {
    const original = window.prompt;
    window.prompt = vi.fn(() => 'My breakfast');
    apiMock.mockImplementation(dayApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Breakfast actions' }));
    await waitFor(() => screen.getByText('Save as meal'));
    fireEvent.click(screen.getByText('Save as meal'));

    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.endsWith('nutrition/templates'))).toBe(true));
    const call = apiMock.mock.calls.find(([p]) => p.endsWith('nutrition/templates'));
    expect(call[1].name).toBe('My breakfast');
    expect(call[1].components).toEqual([expect.objectContaining({ name: 'Eggs', role: 'core', calories: 140 })]);
    expect(call[2]).toBe('POST');
    // The retired write path: nothing goes to the saved-meals store from here.
    expect(apiMock.mock.calls.some(([p]) => p.endsWith('nutrition/meals'))).toBe(false);
    window.prompt = original;
  });

  it('"Move all to" moves every food in the meal and offers one Undo', async () => {
    apiMock.mockImplementation(dayApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Breakfast actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move all of Breakfast to Dinner' }));
    await waitFor(() => expect(apiMock.mock.calls.some(([p, , m]) => p.endsWith('nutrition/foods-move') && m === 'POST')).toBe(true));
    const moves = apiMock.mock.calls.filter(([p]) => p.endsWith('nutrition/foods-move'));
    expect(moves).toHaveLength(1);
    expect(moves[0][1]).toMatchObject({ toMeal: 'evening', selectedIds: ROWS.data.filter(row => row.mealTime === 'morning' && !row.parentId).map(row => row.uuid) });
    expect(await screen.findByRole('button', { name: 'Undo move' })).toBeTruthy();
  });

  it('the add row opens the template picker, which asks for proposals too', async () => {
    apiMock.mockImplementation(dayApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Saved meals for Lunch' }));
    await waitFor(() => expect(
      apiMock.mock.calls.some(([p]) => p.includes('nutrition/templates?includeProposed=1')),
    ).toBe(true));
  });
});

describe('completed meal capture notice', () => {
  beforeEach(()=>{apiMock.mockReset();resetApiResourceCache();});
  it('discards obsolete analyzing messages after committed success and offers Undo',async()=>{
    apiMock.mockImplementation(baseApi({nutritionInput:{committed:true,undoToken:'meal-undo',message:'Analyzing... old transcript',messages:[{text:'Analyzing... old transcript'}]}}));
    r(<TodayView onSetupGoals={()=>{}} onCoachTap={()=>{}}/>);
    fireEvent.click(await screen.findByText('MockPhotoCapture-morning'));
    await screen.findByRole('button',{name:'Undo meal change'});
    expect(screen.queryByText('Analyzing... old transcript')).toBeNull();
  });
});

it('preserves selection on saved voice retry and renders retry clarification choices', async () => {
  apiMock.mockReset(); resetApiResourceCache();
  const foods = [{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300},{uuid:'tomato',name:'Tomato',mealTime:'evening',calories:20,grams:100}];
  let attempt = 0;
  apiMock.mockImplementation(async(path,body)=> {
    if(path.includes('health/day?')) return {items:foods,budget:BUDGET};
    if(path.includes('nutrition/input')) {
      attempt++;
      if(attempt===1) return {transcribeFailed:true,audioRef:'va_saved',responseText:'Recording saved. Try again.'};
      if(attempt===2) return {instructionText:'double this',clarification:{question:'Which broth?',choices:[{id:'broth',label:'Use beef broth'}]}};
      return {committed:true,undoToken:'undo-voice'};
    }
    return baseApi()(path);
  });
  r(<TodayView/>);
  fireEvent.click(await screen.findByRole('button',{name:'Select foods'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Select Beef broth'}));
  fireEvent.click(screen.getByText('MockVoiceCapture-evening'));
  fireEvent.click(await screen.findByRole('button',{name:'Try again',exact:true}));
  await waitFor(()=>expect(apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))).toHaveLength(2));
  const original=apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))[0][1];
  const retry=apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))[1][1];
  expect(retry).toMatchObject({audioRef:'va_saved',bucket:'evening',date:original.date,selectedIds:['broth']});
  fireEvent.click(await screen.findByRole('button',{name:'Use beef broth'}));
  await waitFor(()=>expect(apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))[2]?.[1]).toMatchObject({type:'text',content:'double this',bucket:'evening',date:original.date,selectedIds:['broth'],clarification:'broth'}));
  expect(await screen.findByRole('button',{name:'Undo meal change'})).toBeTruthy();
});

it('retains a departed recording upload with identical bytes, context and operation ID for Retry', async () => {
  apiMock.mockReset(); resetApiResourceCache();
  const foods = [{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300}];
  let attempt=0;
  apiMock.mockImplementation(async(path)=> {
    if(path.includes('health/day?')) return {items:foods,budget:BUDGET};
    if(path.includes('nutrition/input')) {
      if(++attempt===1) throw new Error('Upload disconnected');
      if(attempt===2) return {instructionText:'double this',clarification:{question:'Which broth?',choices:[{id:'broth',label:'Use departed broth'}]}};
      return {committed:true,undoToken:'undo-departed'};
    }
    return baseApi()(path);
  });
  render(<MemoryRouter initialEntries={['/?date=2026-09-05']}><MantineProvider><TodayView/></MantineProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Select foods'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Select Beef broth'}));
  fireEvent.click(screen.getByText('MockDepartedVoiceCapture-evening'));
  fireEvent.click(await screen.findByRole('button',{name:'Try again',exact:true}));
  await waitFor(()=>expect(apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))).toHaveLength(2));
  const inputs=apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'));
  expect(inputs[0][1]).toMatchObject({content:'data:audio/webm;base64,zzz',type:'voice',date:'2026-09-05',bucket:'evening',selectedIds:['broth'],operationId:expect.any(String)});
  expect(inputs[1][1]).toEqual(inputs[0][1]);
  fireEvent.click(await screen.findByRole('button',{name:'Use departed broth'}));
  expect(await screen.findByRole('button',{name:'Undo meal change'})).toBeTruthy();
});

it('offers the same recording Retry when navigation happens during an upload that later rejects', async () => {
  apiMock.mockReset(); resetApiResourceCache(); departureState.departed=false;
  const foods=[{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300}];
  let rejectUpload; const upload=new Promise((resolve,reject)=>{rejectUpload=reject;});
  let attempt=0;
  apiMock.mockImplementation(async(path)=> {
    if(path.includes('health/day?')) return {items:foods,budget:BUDGET};
    if(path.includes('nutrition/input')) return ++attempt===1 ? upload : {committed:true,undoToken:'undo-pending'};
    return baseApi()(path);
  });
  r(<TodayView/>);
  fireEvent.click(await screen.findByRole('button',{name:'Select foods'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Select Beef broth'}));
  fireEvent.click(screen.getByText('MockPendingVoiceCapture-evening'));
  await waitFor(()=>expect(apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'))).toHaveLength(1));
  departureState.departed=true;
  rejectUpload(new Error('Upload disconnected after navigation'));
  fireEvent.click(await screen.findByRole('button',{name:'Try again',exact:true}));
  expect(await screen.findByRole('button',{name:'Undo meal change'})).toBeTruthy();
  const inputs=apiMock.mock.calls.filter(([path])=>path.includes('nutrition/input'));
  expect(inputs[0][1]).toMatchObject({content:'data:audio/webm;base64,zzz',selectedIds:['broth'],bucket:'evening',operationId:expect.any(String)});
  expect(inputs[1][1]).toEqual(inputs[0][1]);
});

describe('TodayView — a barcode the person must hear about', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); barcodeProps.current = null; });

  it('a refused barcode shows its sentence', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { committed: false, outcome: 'rejected-barcode', rejected: 'isbn',
      message: "That's a book (ISBN), not a food.", messages: [{ text: "That's a book (ISBN), not a food." }] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(barcodeProps.current).toBeTruthy());
    await act(async () => { await barcodeProps.current.onDecode('9780306406157', 'afternoon'); });
    expect(await screen.findByText("That's a book (ISBN), not a food.")).toBeTruthy();
  });

  it('a capture held for review says so and refreshes Needs Review', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { committed: false, outcome: 'needs-review', quarantined: true,
      logId: 'L1', message: 'Needs review — no calories found', messages: [] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(barcodeProps.current).toBeTruthy());
    const pendingCalls = () => apiMock.mock.calls.filter(([path]) => String(path).includes('nutrition/pending')).length;
    const before = pendingCalls();
    await act(async () => { await barcodeProps.current.onDecode('037000338369', 'afternoon'); });
    expect(await screen.findByText('Needs review — no calories found')).toBeTruthy();
    await waitFor(() => expect(pendingCalls()).toBeGreaterThan(before));
  });
  it('a label with no calories logged as an AI estimate says it is an estimate', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { committed: true, outcome: 'committed', aiEstimate: true,
      logId: 'L2', messages: [] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(barcodeProps.current).toBeTruthy());
    await act(async () => { await barcodeProps.current.onDecode('037000338369', 'afternoon'); });
    expect(await screen.findByText('No calories on the label — estimated for one serving. Check the row.')).toBeTruthy();
  });
});


// The 15 s poll during a backend restart: every Health resource fails at once.
describe('TodayView — a failed refresh never buries the day', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });
  const serverError = () => Object.assign(new Error('HTTP 500: Internal Server Error'), { status: 500, transient: false });
  const failingDay = (failing) => async (path) => {
    if (failing() && /health\/day\?|nutrition\/pending|nutrition\/observations/.test(path)) throw serverError();
    if (path.includes('health/day?')) return { items: NUTRILIST_WITH_ROW.data, budget: BUDGET };
    return baseApi()(path);
  };

  it('keeps the loaded day and shows one quiet retry line instead of error panels', async () => {
    let failing = false;
    apiMock.mockImplementation(failingDay(() => failing));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bagel')).toBeTruthy());

    failing = true;
    act(() => { window.dispatchEvent(new Event('focus')); });
    const retry = await screen.findByRole('button', { name: /Couldn't refresh/ });
    expect(screen.getByText('Bagel')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Couldn't refresh/ })).toHaveLength(1);

    failing = false;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Couldn't refresh/ })).toBeNull());
    expect(screen.getByText('Bagel')).toBeTruthy();
  });

  it('with nothing loaded, one outage is one panel, not one per resource', async () => {
    apiMock.mockImplementation(failingDay(() => true));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByText('Food log failed to load')).toBeTruthy());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

import { HealthOperationsProvider } from '../operations/HealthOperationsProvider.jsx';
it('keeps multiple sentence operations in the live Today provider independent',async()=>{
 resetApiResourceCache();apiMock.mockReset();
 const tasks=[];
 const saved=[];
 apiMock.mockImplementation((path,body,method)=>{
  if(path.includes('health/day?'))return Promise.resolve({items:saved.map(row=>({...row})),budget:BUDGET});
  if(path.endsWith('nutrition/input')&&method==='POST')return new Promise((resolve,reject)=>tasks.push({body,resolve,reject}));
  return baseApi()(path);
 });
 r(<HealthOperationsProvider userId="fixture"><TodayView onSetupGoals={()=>{}} onCoachTap={()=>{}}/></HealthOperationsProvider>);
 const input=await screen.findByRole('combobox',{name:'Add to Breakfast'});
 input.focus();
 fireEvent.change(input,{target:{value:'eggs'}});fireEvent.keyDown(input,{key:'Enter'});
 fireEvent.change(input,{target:{value:'toast'}});fireEvent.keyDown(input,{key:'Enter'});
 expect(tasks).toHaveLength(2);expect(input.readOnly).toBe(false);
 const date=tasks[0].body.date;
 saved.push({uuid:'toast-op',name:'Toast',date,mealTime:'morning',version:1,calories:100});
 await act(async()=>tasks[1].resolve({committed:true,items:[saved[0]]}));
 expect(await screen.findByRole('button',{name:'Edit Toast'})).toBeTruthy();
 expect(screen.getByText(/Adding.*eggs/i)).toBeTruthy();
 await act(async()=>tasks[0].reject(new Error('eggs offline')));
 expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Edit Toast'}).disabled).toBe(false);
});

describe('TodayView — fixing the day from the capture toast', () => {
  const today = localTodayISO();
  const yesterday = addDaysISO(today, -1);
  const row = (uuid, name, extra = {}) => ({ uuid, id: uuid, name, item: name, calories: 100, grams: 100, unit: 'g', amount: 100, color: 'green',
    date: today, mealTime: 'morning', kind: 'item', version: 1, ...extra });
  const earlier = row('old-1', 'Earlier shake', { logId: 'QUICKADD' });
  const dish = row('dish', 'Burrito', { kind: 'group', logId: 'log-1', calories: 0 });
  const part = row('part', 'Tortilla', { parentId: 'dish', logId: 'log-1' });
  const eggs = row('eggs', 'Eggs', { logId: 'log-1' });
  const capture = { committed: true, outcome: 'committed', undoToken: 'meal-capture', logId: 'log-1', mealTime: 'morning', date: today,
    entryIds: ['dish', 'part', 'eggs'], items: [{ uuid: 'dish', kind: 'group', label: 'Burrito' }, { uuid: 'part', kind: 'item', label: 'Tortilla', parentId: 'dish' }, { uuid: 'eggs', kind: 'item', label: 'Eggs' }] };
  const dayApi = ({ items = [earlier, dish, part, eggs], input = capture, move } = {}) => async (path, body, method) => {
    if (path.includes('health/day?')) return { items, budget: BUDGET };
    if (path.endsWith('nutrition/input')) return input;
    if (path.endsWith('nutrition/foods-move')) return move ? move(body) : { committed: true, undoToken: 'meal-move', date: today, toDate: body.toDate, items: [] };
    return baseApi()(path, body, method);
  };
  const moveCalls = () => apiMock.mock.calls.filter(([path]) => path.endsWith('nutrition/foods-move'));
  const captureFood = async () => {
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await screen.findByText('Eggs', {}, { timeout: 3000 }).catch(() => null);
    fireEvent.click(await screen.findByText('MockPhotoCapture-morning'));
  };

  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('says where the food landed and moves that whole capture, leaving the Undo for the move', async () => {
    apiMock.mockImplementation(dayApi());
    await captureFood();
    expect(await screen.findByText('Added 2 foods to Today, Breakfast')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(moveCalls()).toHaveLength(1));
    expect(moveCalls()[0][1]).toMatchObject({ date: today, toDate: yesterday, selectedIds: ['dish', 'eggs'] });
    expect(await screen.findByRole('button', { name: 'Undo move' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });

  it('a refused move keeps the capture Undo and the day buttons', async () => {
    apiMock.mockImplementation(dayApi({ move: () => { throw Object.assign(new Error('This entry changed.'), { status: 409 }); } }));
    await captureFood();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Couldn't move 2 foods"));
    expect(screen.getByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move to Yesterday' }).disabled).toBe(false));
  });

  it('a shared log ID moves only the rows this capture returned', async () => {
    const added = row('new-1', 'Protein shake', { logId: 'QUICKADD' });
    apiMock.mockImplementation(dayApi({ items: [earlier, added],
      input: { ...capture, logId: 'QUICKADD', entryIds: ['new-1'], items: [{ uuid: 'new-1', kind: 'item', label: 'Protein shake' }] } }));
    await captureFood();
    expect(await screen.findByText('Added Protein shake to Today, Breakfast')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(moveCalls()).toHaveLength(1));
    expect(moveCalls()[0][1].selectedIds).toEqual(['new-1']);
  });

  it('a shared log ID with no exact rows gets no offer', async () => {
    apiMock.mockImplementation(dayApi({ items: [earlier], input: { ...capture, logId: 'QUICKADD', entryIds: [], items: [{ kind: 'item', label: 'Protein shake' }] } }));
    await captureFood();
    expect(await screen.findByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });

  it('a meal instruction gets its Undo and no day offer', async () => {
    apiMock.mockImplementation(dayApi({ input: { committed: true, undoToken: 'meal-amend', logId: null, bucket: 'morning', date: today, items: [eggs] } }));
    await captureFood();
    expect(await screen.findByText('Meal updated')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });

  it('a capture that committed no food gets no offer', async () => {
    apiMock.mockImplementation(dayApi({ input: { ...capture, entryIds: [], items: [{ uuid: 'dish', kind: 'group', label: 'Burrito' }] } }));
    await captureFood();
    expect(await screen.findByText('Meal updated')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Other day…' })).toBeNull();
  });

  it('food filed on a day not being viewed is left alone, and the offer stays', async () => {
    apiMock.mockImplementation(dayApi({ items: [earlier], input: { ...capture, date: yesterday } }));
    await captureFood();
    expect(await screen.findByText('Added 2 foods to Yesterday, Breakfast')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Today' }));
    expect(await screen.findByText('Those foods are on Yesterday. Open that day to move them.')).toBeTruthy();
    expect(moveCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Undo meal change' })).toBeTruthy();
  });

  it('says so when the food has left the viewed day', async () => {
    apiMock.mockImplementation(dayApi({ items: [earlier] }));
    await captureFood();
    await screen.findByText('Added 2 foods to Today, Breakfast');
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path.includes('health/day?')).length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    expect(await screen.findByText('Those foods are no longer on this day.')).toBeTruthy();
    expect(moveCalls()).toHaveLength(0);
  });

  it('asks for a moment while the day is still bringing the food in', async () => {
    const respond = dayApi({ items: [earlier] });
    let dayReads = 0;
    apiMock.mockImplementation((path, body, method) => (path.includes('health/day?') && ++dayReads > 1 ? new Promise(() => {}) : respond(path, body, method)));
    await captureFood();
    await screen.findByText('Added 2 foods to Today, Breakfast');
    await waitFor(() => expect(dayReads).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: 'Move to Yesterday' }));
    expect(await screen.findByText('Those foods are still loading. Try again in a moment.')).toBeTruthy();
    expect(moveCalls()).toHaveLength(0);
  });

  it('a dish holding older food stays out of the move', async () => {
    const older = row('older', 'Older side', { parentId: 'plate', logId: 'log-0' });
    const plate = row('plate', 'Plate', { kind: 'group', logId: 'log-0', calories: 0 });
    const joined = row('joined', 'New side', { parentId: 'plate', logId: 'log-1' });
    apiMock.mockImplementation(dayApi({ items: [plate, older, joined, eggs], input: { ...capture, entryIds: ['joined', 'eggs'],
      items: [{ uuid: 'joined', kind: 'item', label: 'New side' }, { uuid: 'eggs', kind: 'item', label: 'Eggs' }] } }));
    await captureFood();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(moveCalls()).toHaveLength(1));
    expect(moveCalls()[0][1].selectedIds).toEqual(['eggs']);
  });
});

// Every way new food reaches the day, each through the surface a person uses.
describe('TodayView — the day fix after every kind of add', () => {
  const today = localTodayISO();
  const yesterday = addDaysISO(today, -1);
  const row = (uuid, name, extra = {}) => ({ uuid, id: uuid, name, item: name, calories: 100, grams: 100, unit: 'g', amount: 100, color: 'green',
    date: today, mealTime: 'morning', kind: 'item', version: 1, ...extra });
  const parsed = { committed: true, outcome: 'committed', undoToken: 'meal-typed', logId: 'log-9', mealTime: 'morning', date: today,
    entryIds: ['eggs'], items: [{ uuid: 'eggs', kind: 'item', label: 'Eggs' }] };
  const eggs = row('eggs', 'Eggs', { logId: 'log-9' });
  const earlierShake = row('old-shake', 'Earlier shake', { logId: 'QUICKADD' });
  const shake = row('new-shake', 'Protein shake', { logId: 'QUICKADD' });
  const api = ({ items = [earlierShake, eggs], routes = {} } = {}) => async (path, body, method) => {
    const route = Object.keys(routes).find(key => path.includes(key));
    if (route) return routes[route](body, path);
    if (path.includes('health/day?')) return { items, budget: BUDGET };
    if (path.includes('catalog/suggest') || path.includes('catalog/shortlist')) return { items: [{ id: 'cat-1', name: 'Protein shake', nutrients: { calories: 160 } }] };
    if (path.endsWith('nutrition/input')) return parsed;
    if (path.endsWith('nutrition/foods-move')) return { committed: true, undoToken: 'meal-move', date: today, toDate: body.toDate, items: [] };
    return baseApi()(path, body, method);
  };
  const moved = () => apiMock.mock.calls.filter(([path]) => path.endsWith('nutrition/foods-move')).map(([, body]) => body);
  const view = () => <TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />;
  const live = () => r(<HealthOperationsProvider userId="u">{view()}</HealthOperationsProvider>);
  const typeSentence = async text => {
    const input = await screen.findByRole('combobox', { name: 'Add to Breakfast' });
    input.focus();
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  const pickSuggestion = async () => {
    const input = await screen.findByRole('combobox', { name: 'Add to Breakfast' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'shake' } });
    fireEvent.click(await screen.findByRole('option', { name: /Protein shake/ }));
  };
  const moveToYesterday = async expected => {
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Yesterday' }));
    await waitFor(() => expect(moved()).toHaveLength(1));
    expect(moved()[0]).toMatchObject({ toDate: yesterday, selectedIds: expected });
    expect(await screen.findByRole('button', { name: 'Undo move' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull());
  };
  const quickAdded = { logged: true, committed: true, item: { ...shake } };

  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); barcodeProps.current = null; customFoodProps.current = null; });

  it('a typed sentence in the live app gets the toast, its Undo and no second success line', async () => {
    apiMock.mockImplementation(api({ routes: { 'nutrition/input': () => ({ ...parsed, mealTime: 'afternoon' }) } }));
    live();
    await typeSentence('two eggs');
    expect(await screen.findByText('Added Eggs to Today, Lunch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/^Added to/)).toBeNull());
    await moveToYesterday(['eggs']);
  });

  it('a typed sentence without the operations session gets the same toast', async () => {
    apiMock.mockImplementation(api());
    r(view());
    await typeSentence('two eggs');
    expect(await screen.findByText('Added Eggs to Today, Breakfast')).toBeTruthy();
    await moveToYesterday(['eggs']);
  });

  it('a typed meal instruction gets no day offer', async () => {
    apiMock.mockImplementation(api({ routes: { 'nutrition/input': () => ({ committed: true, undoToken: 'meal-amend', logId: null, items: [eggs] }) } }));
    live();
    await typeSentence('double the eggs');
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.endsWith('nutrition/input'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });

  it.each([['the live app', live], ['no operations session', () => r(view())]])('a picked suggestion in %s moves only its own row and shows no Undo', async (_name, mount) => {
    apiMock.mockImplementation(api({ items: [earlierShake, shake], routes: { 'catalog/quickadd': () => quickAdded } }));
    mount();
    await pickSuggestion();
    expect(await screen.findByText('Added Protein shake to Today, Breakfast')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull();
    await moveToYesterday(['new-shake']);
  });

  it('an add with no Undo of its own leaves an earlier capture Undo in place', async () => {
    apiMock.mockImplementation(api({ items: [earlierShake, shake, eggs], routes: { 'catalog/quickadd': () => quickAdded } }));
    live();
    await typeSentence('two eggs');
    expect(await screen.findByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    await pickSuggestion();
    expect(await screen.findByText('Added Protein shake to Today, Breakfast')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo meal change' })).toBeTruthy();
  });

  it('a scanned barcode gets the toast and its Undo', async () => {
    apiMock.mockImplementation(api({ routes: { 'nutrition/input': () => ({ ...parsed, moved: true, mealTime: 'afternoon', undoToken: 'meal-upc' }) } }));
    r(view());
    await waitFor(() => expect(barcodeProps.current).toBeTruthy());
    await act(async () => { await barcodeProps.current.onDecode('037000338369', 'morning'); });
    expect(await screen.findByText('Added Eggs to Today, Lunch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo meal change' })).toBeTruthy();
    expect(screen.queryByText('Moved to Lunch')).toBeNull();
    await moveToYesterday(['eggs']);
  });

  it('a barcode held for review gets no offer', async () => {
    apiMock.mockImplementation(api({ routes: { 'nutrition/input': () => ({ committed: false, outcome: 'needs-review', logId: 'held', message: 'Needs review' }) } }));
    r(view());
    await waitFor(() => expect(barcodeProps.current).toBeTruthy());
    await act(async () => { await barcodeProps.current.onDecode('037000338369', 'morning'); });
    expect(await screen.findByText('Needs review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to Yesterday' })).toBeNull();
  });

  it('a food created for an unknown barcode gets the toast without an Undo', async () => {
    apiMock.mockImplementation(api({ items: [earlierShake, shake] }));
    r(view());
    await waitFor(() => expect(customFoodProps.current).toBeTruthy());
    await act(async () => { customFoodProps.current.onCreated(quickAdded); });
    expect(await screen.findByText('Added Protein shake to Today, Breakfast')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull();
    await moveToYesterday(['new-shake']);
  });

  it('a logged saved meal moves whole, and earlier rows of the same kind stay', async () => {
    const earlierMeal = row('old-meal', 'Earlier toast', { logId: 'TEMPLATE' });
    const header = row('meal-head', 'Protein breakfast', { kind: 'group', logId: 'TEMPLATE', calories: 0 });
    const toast = row('meal-toast', 'Toast', { parentId: 'meal-head', logId: 'TEMPLATE' });
    const template = { id: 't2', name: 'Saved plate', status: 'active', source: 'manual', components: [{ name: 'Toast', calories: 100, role: 'core' }] };
    apiMock.mockImplementation(api({ items: [earlierMeal, header, toast], routes: {
      'nutrition/templates?': () => ({ templates: [template] }),
      'templates/t2/instantiate': () => ({ committed: true, groupUuid: 'meal-head', items: [header, toast] }),
    } }));
    r(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Saved meals for Breakfast' }));
    fireEvent.click(await screen.findByText('Saved plate'));
    expect(await screen.findByText('Added Toast to Today, Breakfast')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull();
    await moveToYesterday(['meal-head']);
  });

  it('food confirmed from Needs Review is found by its log', async () => {
    const pending = { id: 'held-log', version: 'v1', date: today, source: 'telegram', mealTime: 'morning', items: [{ id: 'held-1', label: 'Held shake', calories: 160 }] };
    let confirmed = false;
    const heldRow = row('held-row', 'Held shake', { logId: 'held-log' });
    apiMock.mockImplementation(async (path, body, method) => {
      if (path.endsWith('pending/held-log/review')) { confirmed = true; return { success: true, logUuid: 'held-log', status: 'accepted' }; }
      if (path.includes('nutrition/pending')) return { pending: confirmed ? [] : [pending] };
      if (path.includes('health/day?')) return { items: confirmed ? [heldRow] : [], budget: BUDGET };
      return api()(path, body, method);
    });
    r(view());
    fireEvent.click(await screen.findByRole('button', { name: /^Review food$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm food' }));
    expect(await screen.findByText('Added Held shake to Today, Breakfast')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull();
    await waitFor(() => expect(document.querySelector('.health-row__name')?.textContent).toBe('Held shake'));
    await moveToYesterday(['held-row']);
  });

  it('a meal copied to today says so once and offers the move', async () => {
    const source = row('source', 'Oatmeal', { date: yesterday });
    apiMock.mockImplementation(api({ items: [source], routes: { 'nutrition/copy': () => ({ committed: true, items: [row('copy-1', 'Oatmeal', { logId: 'COPY' })], affectedIds: ['copy-1'], affectedDates: [today] }) } }));
    render(<MemoryRouter initialEntries={[`/?date=${yesterday}`]}><MantineProvider>{view()}</MantineProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Breakfast actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy to today' }));
    expect(await screen.findByText('Breakfast copied to today.')).toBeTruthy();
    expect(document.querySelectorAll('.ds-toast')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Move to Yesterday' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo meal change' })).toBeNull();
  });
});
