import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import usePianoWatchLog from './usePianoWatchLog.js';
import { DaylightAPI } from '../../../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const el = () => ({ currentTime: 95, duration: 100, paused: false, readyState: 4, addEventListener() {}, removeEventListener() {} });

beforeEach(() => { DaylightAPI.mockReset(); });

describe('usePianoWatchLog practice + credit', () => {
  it('posts the practice report and hands the credit back; postNow resolves with it', async () => {
    DaylightAPI.mockResolvedValue({ userProgress: { credit: { outcome: 'drill-owed', drill: { reps: 2 } } } });
    const onCredit = vi.fn();
    const practiceReport = vi.fn(() => ({ sittingId: 's', humanNotes: 1, practiceNotes: 1, playedSec: 9 }));
    const { result } = renderHook(() => usePianoWatchLog({
      mediaEl: el(), contentId: 'plex:1', title: 'T', resumeSeconds: 0, userId: 'kid', engagedRef: { current: true }, practiceReport, onCredit,
    }));
    let credit;
    await act(async () => { credit = await result.current.postNow('close'); });
    expect(DaylightAPI.mock.calls[0][1].practice).toEqual({ sittingId: 's', humanNotes: 1, practiceNotes: 1, playedSec: 9 });
    expect(credit).toEqual({ outcome: 'drill-owed', drill: { reps: 2 } });
    expect(onCredit).toHaveBeenCalledWith({ outcome: 'drill-owed', drill: { reps: 2 } });
  });

  it('postNow resolves null on failure', async () => {
    DaylightAPI.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePianoWatchLog({ mediaEl: el(), contentId: 'plex:1', title: 'T', resumeSeconds: 0, userId: 'kid', engagedRef: { current: true } }));
    let credit = 'x';
    await act(async () => { credit = await result.current.postNow('close'); });
    expect(credit).toBeNull();
  });
});
