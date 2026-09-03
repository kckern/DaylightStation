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
  if (path.includes('nutrition/input')) return overrides.nutritionInput ?? {};
  return {};
};

describe('TodayView — photo/voice capture pendings (I-4)', () => {
  beforeEach(() => { apiMock.mockReset(); });

  // Captures are committed on arrival now, so the server sends Undo/Edit — never Accept.
  it('an image submit whose response carries choices renders the review card with Undo', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: {
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
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => expect(screen.getByText(/350 kcal/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(document.querySelector('.health-pending')).toBeTruthy();
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

  const committedChoices = [[
    { text: '↩️ Undo', callback_data: '{"cmd":"x","id":"log-1"}' },
    { text: '✏️ Edit', callback_data: '{"cmd":"r","id":"log-1"}' },
  ]];

  it('dismissing a committed capture clears the card and reloads the day', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { messages: [{ text: 'Grilled chicken — 350 kcal', choices: committedChoices }] },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));
    await waitFor(() => screen.getByRole('button', { name: /done/i }));

    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    await waitFor(() => expect(document.querySelector('.health-pending')).toBeFalsy());
    // day.reload() re-fetches nutrilist+budget.
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore + 1));
  });

  it('Undo posts the discard callback AND reloads the day (it deletes a counting entry)', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: { messages: [{ text: 'Grilled chicken — 350 kcal', choices: committedChoices }] },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));
    await waitFor(() => screen.getByRole('button', { name: /undo/i }));

    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(() => expect(document.querySelector('.health-pending')).toBeFalsy());
    const after = apiMock.mock.calls.slice(callsBefore);
    expect(after.some(([path]) => path.includes('nutrition/callback'))).toBe(true);
    expect(after.some(([path]) => path.includes('nutrilist'))).toBe(true);
  });
});
