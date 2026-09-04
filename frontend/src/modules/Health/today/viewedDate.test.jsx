/**
 * The viewed day must travel with every capture the Today view can start.
 *
 * The reported defect: food entered while looking at YESTERDAY appeared on
 * TODAY. Nothing on this surface was sending the day it was showing — the
 * server dated every row from its own clock. These pin the wire bodies, which
 * is the only place the bug was ever visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

vi.mock('../capture/PhotoCapture.jsx', () => ({
  PhotoCapture: ({ onCapture, bucket }) => (
    <button onClick={() => onCapture('data:image/png;base64,zzz', bucket)}>{`MockPhotoCapture-${bucket}`}</button>
  ),
}));
vi.mock('../capture/VoiceCapture.jsx', () => ({
  VoiceCapture: ({ onCapture, bucket }) => (
    <button onClick={() => onCapture('data:audio/webm;base64,zzz', bucket)}>{`MockVoiceCapture-${bucket}`}</button>
  ),
}));
vi.mock('../capture/BarcodeCapture.jsx', () => ({ BarcodeCapture: () => null }));
vi.mock('../capture/CustomFoodSheet.jsx', () => ({ CustomFoodSheet: () => null }));
vi.mock('./QuickCaptureBar.jsx', () => ({ QuickCaptureBar: () => null }));

import { TodayView } from './TodayView.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { localTodayISO } from './mealBuckets.js';
import { addDays } from './WeekStrip.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const NUTRILIST = { data: [] };
const BUDGET = { budget: 2000, food: 0, exercise: 0, remaining: 2000, status: 'under', sessions: [] };

const baseApi = () => async (path) => {
  if (path.includes('nutrition/observations')) return { observations: [] };
  if (path.includes('nutrilist/')) return NUTRILIST;
  if (path.includes('budget')) return BUDGET;
  if (path.includes('dashboard')) return { today: { coaching: [] } };
  if (path.includes('nutrition/pending')) return { pending: [] };
  return {};
};

const YESTERDAY = addDays(localTodayISO(), -1);

describe('TodayView — the viewed day rides along with a capture', () => {
  beforeEach(() => { apiMock.mockReset(); resetApiResourceCache(); });

  it('a capture made while viewing TODAY sends today', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockVoiceCapture-morning'));
    fireEvent.click(screen.getByText('MockVoiceCapture-morning'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('nutrition/input'))).toBe(true));
    const [, body] = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(body.date).toBe(localTodayISO());
    expect(body.bucket).toBe('morning');
  });

  it('after navigating to YESTERDAY, the same capture sends yesterday — the reported defect', async () => {
    apiMock.mockImplementation(baseApi());
    r(<TodayView onSetupGoals={() => {}} onCoachTap={() => {}} />);
    await waitFor(() => screen.getByText('MockVoiceCapture-morning'));

    // The week strip is how a person gets to another day.
    const cells = document.querySelectorAll('.health-weekstrip__cell');
    const yesterdayCell = cells[cells.length - 2];
    fireEvent.click(yesterdayCell);
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes(`nutrilist/${YESTERDAY}`))).toBe(true));

    fireEvent.click(screen.getByText('MockVoiceCapture-morning'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('nutrition/input'))).toBe(true));
    const [, body] = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(body.date).toBe(YESTERDAY);
  });
});

describe('AddCombobox — the viewed day rides along', () => {
  const SUGGEST = { items: [{ id: 'a', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } }] };
  beforeEach(() => { apiMock.mockReset(); });

  it('a quick-add sends the viewed day and the meal row it was launched from', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return SUGGEST;
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-1' } };
      return {};
    });
    r(<AddCombobox bucketId="afternoon" date={YESTERDAY} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('quickadd'))).toBe(true));
    const [, body] = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(body).toEqual({ catalogEntryId: 'a', mealTime: 'afternoon', date: YESTERDAY });
  });

  it('a typed sentence sends BOTH the viewed day and the bucket — the bucket used to be dropped here', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      return {};
    });
    r(<AddCombobox bucketId="afternoon" date={YESTERDAY} onDone={() => {}} onCancel={() => {}} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'two eggs and toast' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('nutrition/input'))).toBe(true));
    const [, body] = apiMock.mock.calls.find(([p]) => p.includes('nutrition/input'));
    expect(body).toEqual({ type: 'text', content: 'two eggs and toast', bucket: 'afternoon', date: YESTERDAY });
  });

  it('with no viewed day the body is unchanged — absent still means today', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return SUGGEST;
      if (path.includes('quickadd')) return { logged: true, item: { uuid: 'row-1' } };
      return {};
    });
    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('quickadd'))).toBe(true));
    const [, body] = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(body).toEqual({ catalogEntryId: 'a', mealTime: 'afternoon' });
    expect('date' in body).toBe(false);
  });
});
