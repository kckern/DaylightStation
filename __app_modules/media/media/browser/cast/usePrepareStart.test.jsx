import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const DaylightAPI = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => DaylightAPI(...a) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import mediaLog from "../logging/mediaLog.js";
import { usePrepareStart, resetPreparedStarts, PREPARE_DEBOUNCE_MS } from "./usePrepareStart.js";

const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, ...(body ? { body } : {}) });

async function look(contentId, targetIds = ['office-tv']) {
  const view = renderHook(() => usePrepareStart({ id: contentId }, targetIds));
  await act(async () => { vi.advanceTimersByTime(PREPARE_DEBOUNCE_MS); await Promise.resolve(); await Promise.resolve(); });
  view.unmount();
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); resetPreparedStarts(); });
afterEach(() => vi.useRealTimers());

describe('usePrepareStart error branches', () => {
  it('an unknown screen (404 DEVICE_NOT_FOUND) is skipped silently, and the route stays in use', async () => {
    DaylightAPI.mockRejectedValueOnce(httpError(404, { ok: false, code: 'DEVICE_NOT_FOUND' }));
    await look('plex:1', ['gone-tv']);
    expect(mediaLog.playPrepareUnavailable).not.toHaveBeenCalled();
    expect(mediaLog.playPrepareFailed).not.toHaveBeenCalled();
    // Not asked again for that screen…
    await look('plex:1', ['gone-tv']);
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    // …but other screens still are.
    DaylightAPI.mockResolvedValueOnce({ ok: true, status: 'ok' });
    await look('plex:1', ['office-tv']);
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it.each([[404], [501]])('a build without the route (%s) logs unavailable once and is never asked again', async (status) => {
    DaylightAPI.mockRejectedValue(httpError(status));
    await look('plex:1');
    await look('plex:2');
    await look('plex:3', ['den-tv']);
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    expect(mediaLog.playPrepareUnavailable).toHaveBeenCalledTimes(1);
  });

  it('any other error lets a later look of the same item try again', async () => {
    DaylightAPI.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({ ok: true, status: 'ok' });
    await look('plex:1');
    expect(mediaLog.playPrepareFailed).toHaveBeenCalledTimes(1);
    await look('plex:1');
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
    expect(mediaLog.playPrepared).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1', targetIds: ['office-tv'] }));
  });

  it('a busy screen lets a later look try again; a prepared one does not', async () => {
    DaylightAPI.mockResolvedValueOnce({ ok: false, status: 'busy' }).mockResolvedValue({ ok: true, status: 'ok' });
    await look('plex:1');
    await look('plex:1');
    await look('plex:1');
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });
});
