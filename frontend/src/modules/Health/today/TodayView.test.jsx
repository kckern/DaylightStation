import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Bypass the real file-picker/FileReader and MediaRecorder plumbing — the
// thing under test is TodayView's handling of the /nutrition/input response,
// not the capture widgets themselves (those have their own tests).
vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ onCapture }) => (
    <button onClick={() => onCapture('data:image/png;base64,zzz')}>MockPhotoCapture</button>
  ),
}));
vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: () => null }));
vi.mock('../capture/BarcodeCapture.jsx', () => ({ BarcodeCapture: () => null }));
vi.mock('../capture/CustomFoodSheet.jsx', () => ({ CustomFoodSheet: () => null }));

import { TodayView } from './TodayView.jsx';

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
  beforeEach(() => { apiMock.mockReset(); });

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
