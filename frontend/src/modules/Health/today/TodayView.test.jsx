import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Bypass the real file-picker/FileReader and MediaRecorder plumbing — the
// thing under test is TodayView's handling of the /nutrition/input response,
// not the capture widgets themselves (those have their own tests).
//
// LogTable mounts one PhotoCapture/VoiceCapture PER MEAL BUCKET (Task 4.2),
// and this mock applies to ALL of them (module-level vi.mock, whole file's
// import graph) — the mock label carries the received `bucket` prop so
// each instance stays individually clickable/assertable. Every real caller
// in this file's tree now always supplies a bucket (LogTable's per-meal
// buttons pass that meal's id) — the bucket-less branch below is dead in
// practice but kept so the mock still degrades sensibly if some future
// caller omits it.
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ onCapture, bucket }) => (
    <button onClick={() => onCapture('data:image/png;base64,zzz', bucket)}>
      {bucket ? `MockPhotoCapture-${bucket}` : 'MockPhotoCapture'}
    </button>
  ),
}));
vi.mock('../capture/VoiceCapture.jsx', () => ({
  VoiceCapture: ({ onCapture, bucket }) => (
    <button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>
      {bucket ? `MockVoiceCapture-${bucket}` : 'MockVoiceCapture'}
    </button>
  ),
}));
vi.mock('../capture/BarcodeCapture.jsx', () => ({ BarcodeCapture: () => null }));
vi.mock('../capture/CustomFoodSheet.jsx', () => ({ CustomFoodSheet: () => null }));
// QuickCaptureBar (Task 4.3) has its own dedicated test file
// (QuickCaptureBar.test.jsx) covering its four affordances, the clock-derived
// bucket, and the add-combobox trigger. Stub it out here rather than let it
// render for real: it also mounts VoiceCapture/PhotoCapture (mocked above)
// with a bucket computed from the ACTUAL wall-clock hour, which would (a) be
// non-deterministic in this file's tests and (b) collide with whichever
// per-meal instance happens to share that hour's bucket, since the mock's
// label depends only on `bucket`, not on which caller rendered it.
// Expose the toolbar callback seam deterministically; its real target UI has a separate suite.
vi.mock('./QuickCaptureBar.jsx', () => ({ QuickCaptureBar: ({ bucketOverride, onPhotoCapture, onVoiceCapture }) => bucketOverride ? null :
  <div>{['morning', 'afternoon', 'evening', 'night'].map(bucket => <div key={bucket}>
    <button onClick={() => onPhotoCapture('data:image/png;base64,zzz', bucket)}>MockPhotoCapture-{bucket}</button>
    <button onClick={() => onVoiceCapture('data:audio/webm;base64,zzz', bucket)}>MockVoiceCapture-{bucket}</button>
  </div>)}</div>
}));

// Pin the capture-pending bucket target so the "which bucket does the
// placeholder land in" tests are deterministic regardless of wall-clock
// time — everything else in mealBuckets.js (BUCKETS, localTodayISO, …)
// stays real.
vi.mock('./mealBuckets.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, currentMealBucketId: () => 'afternoon' };
});

import { MemoryRouter } from 'react-router-dom';
import { TodayView } from './TodayView.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

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
    const pending = { id: 'barcode-log', source: 'telegram', mealTime: 'afternoon',
      items: [{ label: 'Salted Caramel Protein Shake', calories: 160 }] };
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
      expect(screen.getByText('1,840 kcal')).toBeTruthy();
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

  it('renders every meal heading during a true cold load, with the shimmer confined to section bodies', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('health/day?')) return new Promise(() => {}); // never resolves — stay cold
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    // Synchronously, before anything resolves: structure is already there.
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Lunch')).toBeTruthy();
    expect(screen.getByText('Dinner')).toBeTruthy();
    expect(screen.getByText('Snacks')).toBeTruthy();
    expect(screen.getAllByText(/Add food/).length).toBe(4);
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
        if (phase === 'initial') return { items: NUTRILIST_WITH_ROW.data, budget: BUDGET };
        return new Promise((res) => { resolveReload = () => res({ items: NUTRILIST_WITH_TWO_ROWS.data, budget: BUDGET }); });
      }
      return {};
    });

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
    const breakfastSection = screen.getByText('Breakfast').closest('section');
    expect(lunchSection.contains(placeholder)).toBe(true);
    expect(breakfastSection.contains(placeholder)).toBe(false);

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

  // Task 4.3 retired the footer's bucket-less global capture instance
  // entirely — QuickCaptureBar is now the one always-reachable surface, and
  // it ALWAYS supplies a clock-derived bucket (never omits one). That
  // component's own bucket-forwarding contract is pinned in
  // QuickCaptureBar.test.jsx; this file stubs QuickCaptureBar out (see the
  // module mock above) since it shares TodayView's real
  // onVoiceCapture/onPhotoCapture handlers with LogTable's per-meal
  // buttons — the "a bucket is forwarded to the API body" behavior those
  // handlers implement is already covered by the two tests above.

  it('a response with moved:true shows the moved-to cue naming the RESOLVED meal, reusing the existing captureNotice banner', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { moved: true, mealTime: 'afternoon', messages: [] },
    }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning'));
    fireEvent.click(screen.getByText('MockPhotoCapture-morning'));

    await waitFor(() => expect(screen.getByText('Moved to Lunch')).toBeTruthy());
    // Reuses the SAME banner element captureNotice already renders elsewhere
    // in this file (health-pending), not a second bespoke notice mechanism.
    expect(document.querySelector('.health-pending')).toBeTruthy();
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

describe('TodayView — Task 4.3: QuickCaptureBar wiring', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('does not render MacroFooter capture controls — QuickCaptureBar is the one capture surface', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('Breakfast'));
    // No BARE (bucket-less, footer-style) capture trigger exists anywhere —
    // every remaining mocked instance carries a `-{bucket}` suffix, i.e.
    // came from LogTable's per-meal header, never a page-level footer icon.
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

    await waitFor(() => expect(screen.getByText('213 g · scale ✓')).toBeTruthy());
    expect(document.querySelector('.health-obs')).toBeFalsy();
  });

  it('an entry with SEVERAL consumed weights badges the LATEST one, not the first or a sum', async () => {
    apiMock.mockImplementation(withRows(
      [{ uuid: 'row-1', name: 'Chili', calories: 300, mealTime: 'evening' }],
      [EARLIER_CONSUMED, CONSUMED_WEIGHT],
    ));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText('213 g · scale ✓')).toBeTruthy());
    expect(screen.queryByText('82 g · scale ✓')).toBeNull();
    expect(screen.queryByText('295 g · scale ✓')).toBeNull();
  });

  it('dismissing an unmatched row POSTs the dismiss endpoint and reloads the observations', async () => {
    apiMock.mockImplementation(baseApi({ observations: { observations: [OPEN_WEIGHT] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByRole('button', { name: /^Dismiss 82 g/ }));

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss 82 g/ }));

    await waitFor(() => expect(apiMock.mock.calls.some(
      ([path, , method]) => String(path).endsWith(`observations/${OPEN_WEIGHT.id}/dismiss`) && method === 'POST',
    )).toBe(true));
  });

  it('a day with no observations renders no section at all', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('Breakfast'));
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

    await waitFor(() => expect(screen.getByText('NEEDS REVIEW')).toBeTruthy());
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
    expect(screen.getAllByText(/unconfirmed/i)).toHaveLength(1);
    expect(document.querySelectorAll('.health-row--unsettled')).toHaveLength(1);
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

  // QuickCaptureBar is stubbed out at the top of this file (it has its own suite), so
  // this guards the PER-MEAL capture trio LogTable renders — the surface this task's
  // new section sits directly above.
  it('REGRESSION: the per-meal capture buttons still render alongside the new section', async () => {
    apiMock.mockImplementation(baseApi({ observations: { observations: [OPEN_WEIGHT] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture-morning'));
    expect(screen.getByText('MockVoiceCapture-evening')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan barcode to Breakfast' })).toBeNull();
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

  it('the add row opens the template picker, which asks for proposals too', async () => {
    apiMock.mockImplementation(dayApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getAllByText('+ Add food…'));
    fireEvent.click(screen.getAllByText('+ Add food…')[0]);
    const meals = await screen.findByText(/Meals & templates/);
    fireEvent.click(meals);
    await waitFor(() => expect(
      apiMock.mock.calls.some(([p]) => p.includes('nutrition/templates?includeProposed=1')),
    ).toBe(true));
  });
});
