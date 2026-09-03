import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Bypass the real file-picker/FileReader and MediaRecorder plumbing — the
// thing under test is TodayView's handling of the /nutrition/input response,
// not the capture widgets themselves (those have their own tests).
//
// LogTable now mounts one PhotoCapture/VoiceCapture PER MEAL BUCKET (Task
// 4.2) in addition to the footer's single global instance, and this mock
// applies to ALL of them (module-level vi.mock, whole file's import graph).
// The mock label carries the received `bucket` prop so each instance stays
// individually clickable/assertable — the footer's instance (no bucket
// prop) keeps the original unsuffixed 'MockPhotoCapture'/'MockVoiceCapture'
// text so every pre-existing assertion in this file keeps matching exactly
// one element.
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

// Pin the capture-pending bucket target so the "which bucket does the
// placeholder land in" tests are deterministic regardless of wall-clock
// time — everything else in mealBuckets.js (BUCKETS, localTodayISO, …)
// stays real.
vi.mock('./mealBuckets.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, currentMealBucketId: () => 'afternoon' };
});

import { TodayView } from './TodayView.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const NUTRILIST = { data: [] };
const BUDGET = { budget: 2000, food: 0, exercise: 0, remaining: 2000, status: 'under', sessions: [] };
const DASHBOARD = { today: { coaching: [] } };

const baseApi = (overrides = {}) => async (path) => {
  if (path.includes('nutrilist/')) return NUTRILIST;
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
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByText('MockPhotoCapture'));

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
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => expect(screen.getByText(/couldn't identify/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /accept/i })).toBeFalsy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/couldn't identify/i)).toBeFalsy();
  });

  it('the NeedsReviewSection mount is only fed scale-origin pending logs (telegram/web are filtered out)', async () => {
    apiMock.mockImplementation(baseApi({
      pending: {
        pending: [
          { id: 'log-1', source: 'telegram', items: [{ label: 'Oatmeal', calories: 210 }] },
          { id: 'log-2', source: 'scale', items: [{ label: 'Chicken breast', calories: 231 }] },
        ],
      },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);

    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(screen.queryByText('Oatmeal')).toBeFalsy();
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
      if (path.includes('nutrilist/')) return new Promise(() => {}); // never resolves — stay cold
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
      if (path.includes('nutrilist/')) return NUTRILIST_WITH_ROW;
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
      if (path.includes('nutrilist/')) {
        if (phase === 'initial') return NUTRILIST_WITH_ROW;
        return new Promise((res) => { resolveReload = () => res(NUTRILIST_WITH_TWO_ROWS); });
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
      if (path.includes('nutrilist/')) return NUTRILIST;
      if (path.includes('budget')) return BUDGET; // sessions: []
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => expect(screen.getByText('Exercise')).toBeTruthy());
  });

  it('shows an in-place "Analyzing…" placeholder in the target bucket while a capture is in flight, cleared once the result lands', async () => {
    let resolveInput;
    apiMock.mockImplementation(async (path) => {
      if (path.includes('nutrilist/')) return NUTRILIST;
      if (path.includes('budget')) return BUDGET;
      if (path.includes('dashboard')) return DASHBOARD;
      if (path.includes('nutrition/pending')) return { pending: [] };
      if (path.includes('nutrition/input')) return new Promise((res) => { resolveInput = res; });
      return {};
    });

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => expect(screen.getByText('Analyzing…')).toBeTruthy());
    const placeholder = screen.getByText('Analyzing…');
    expect(placeholder.closest('[aria-busy="true"]')).toBeTruthy();
    // currentMealBucketId() is mocked to 'afternoon' (Lunch) for this file.
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

  it('the footer\'s global capture instance still omits bucket — the backward-compat/clock path is untouched', async () => {
    apiMock.mockImplementation(baseApi({ nutritionInput: { messages: [] } }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture')); // footer's unsuffixed instance
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path]) => String(path).includes('nutrition/input'));
      expect(call).toBeTruthy();
      expect(call[1]).not.toHaveProperty('bucket');
    });
  });

  it('a response with moved:true shows the moved-to cue naming the RESOLVED meal, reusing the existing captureNotice banner', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { moved: true, mealTime: 'afternoon', messages: [] },
    }));
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));

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
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByText(/^Moved to/)).toBeNull();
  });
});
