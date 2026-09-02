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

  it('an image submit whose response carries choices renders PendingConfirmCard with Accept', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: {
        messages: [{ text: 'Grilled chicken — 350 kcal', choices: [[{ text: '✅ Accept', callback_data: 'cb-1' }]] }],
      },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));

    await waitFor(() => expect(screen.getByText(/350 kcal/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
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

  it('accepting a pending capture clears the card and reloads the day', async () => {
    apiMock.mockImplementation(baseApi({
      nutritionInput: {
        messages: [{ text: 'Grilled chicken — 350 kcal', choices: [[{ text: '✅ Accept', callback_data: 'cb-1' }]] }],
      },
    }));

    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockPhotoCapture'));
    fireEvent.click(screen.getByText('MockPhotoCapture'));
    await waitFor(() => screen.getByRole('button', { name: /accept/i }));

    const callsBefore = apiMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(document.querySelector('.health-pending')).toBeFalsy());
    // Accept posts the callback, then day.reload() re-fetches nutrilist+budget.
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore + 1));
  });
});
