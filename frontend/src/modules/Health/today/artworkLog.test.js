import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.fn();
const warn = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock('../../../lib/ui/createAppLogger.js', () => ({ createAppLogger: () => ({ child: () => ({ warn: (...args) => warn(...args) }) }) }));

const { reportArtworkFailure, resetArtworkReports, artworkFailuresPath } = await import('./artworkLog.js');

beforeEach(() => { api.mockReset(); warn.mockReset(); resetArtworkReports(); api.mockResolvedValue({ queued: true }); });

describe('reportArtworkFailure', () => {
  it('logs and queues a photo failure once per key per session', () => {
    reportArtworkFailure('photo', 'ph_x', { uuid: 'row-1', name: 'Shake', icon: 'default' });
    reportArtworkFailure('photo', 'ph_x', { uuid: 'row-1', name: 'Shake', icon: 'default' });
    expect(warn).toHaveBeenCalledWith('artwork.photo-failed', { key: 'ph_x', uuid: 'row-1', name: 'Shake', icon: 'default' });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(artworkFailuresPath, { kind: 'photo-failed', key: 'ph_x', uuid: 'row-1', name: 'Shake', icon: 'default' }, 'POST');
  });

  it('queues an icon failure keyed by its slug', () => {
    reportArtworkFailure('icon', 'apple', { url: '/x', reason: 'load' });
    expect(api).toHaveBeenCalledWith(artworkFailuresPath, { kind: 'icon-failed', key: 'apple', uuid: null, name: null, icon: null }, 'POST');
  });

  it('never throws when the report cannot be sent', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    expect(() => reportArtworkFailure('icon', 'pear')).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('artwork.queue.report-failed', expect.objectContaining({ error: 'offline' }));
    api.mockImplementationOnce(() => { throw new Error('sync'); });
    expect(() => reportArtworkFailure('icon', 'plum')).not.toThrow();
  });
});
