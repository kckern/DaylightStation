import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('../../lib/logging/Logger.js', () => {
  const child = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const getLogger = () => ({ child, debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return {
    default: getLogger,
    getLogger,
    getRecentEvents: vi.fn(() => []),
    getConfig: vi.fn(() => ({ context: {} })),
  };
});

import { DaylightAPI } from '../../lib/api.mjs';
import { getRecentEvents, getConfig } from '../../lib/logging/Logger.js';
import { autoReport, resetAutoReportState, AUTO_REPORT_MAX_PER_SESSION } from './autoReport.js';

const oneEvent = (i) => ({ ts: `2026-08-16T18:3${i % 10}:00.000Z`, level: 'warn', event: `e${i}`, data: {} });

beforeEach(() => {
  DaylightAPI.mockReset();
  DaylightAPI.mockResolvedValue({ id: 'abc', app: 'piano' });
  getRecentEvents.mockReset();
  getRecentEvents.mockReturnValue([oneEvent(1), oneEvent(2)]);
  getConfig.mockReset();
  getConfig.mockReturnValue({ context: {} });
  resetAutoReportState();
});

describe('autoReport', () => {
  it('POSTs a feedback submission with no audio and the recent log ring', async () => {
    await autoReport({ app: 'piano', reason: 'stall-detector', detail: { position: 0 } });

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const [path, body, method] = DaylightAPI.mock.calls[0];
    expect(path).toBe('api/v1/feedback');
    expect(method).toBe('POST');
    expect(body.app).toBe('piano');
    expect(body.audioBase64).toBeNull();
    expect(body.durationMs).toBe(0);
    expect(body.logs.recent).toHaveLength(2);
    expect(getRecentEvents).toHaveBeenCalledWith(150);
  });

  it('marks the report as machine-filed and carries the reason and detail', async () => {
    await autoReport({ app: 'piano', reason: 'stall-detector', detail: { deviceId: 'piano-tablet', position: 0 } });

    const body = DaylightAPI.mock.calls[0][1];
    expect(body.context.auto).toBe(true);
    expect(body.context.reason).toBe('stall-detector');
    expect(body.context.deviceId).toBe('piano-tablet');
    expect(body.context.position).toBe(0);
  });

  it('falls back to the app the logger was configured with', async () => {
    getConfig.mockReturnValue({ context: { app: 'piano-kiosk' } });

    await autoReport({ reason: 'error-boundary' });

    expect(DaylightAPI.mock.calls[0][1].app).toBe('piano-kiosk');
  });

  it('files nothing when no app can be resolved', async () => {
    const result = await autoReport({ reason: 'error-boundary' });

    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // ── Deduplication: a storm that files 495 reports is a second incident ────

  it('files one report per incident, not one per tick', async () => {
    for (let i = 0; i < 50; i += 1) {
       
      await autoReport({ app: 'piano', reason: 'stall-detector' });
    }

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });

  it('treats a different reason as a different incident', async () => {
    await autoReport({ app: 'piano', reason: 'stall-detector' });
    await autoReport({ app: 'piano', reason: 'error-boundary' });

    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('separates incidents by an explicit key', async () => {
    await autoReport({ app: 'piano', reason: 'error-boundary', dedupeKey: 'VideoPlayer' });
    await autoReport({ app: 'piano', reason: 'error-boundary', dedupeKey: 'VideoPlayer' });
    await autoReport({ app: 'piano', reason: 'error-boundary', dedupeKey: 'GameBoundary' });

    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('re-files the same incident once its cooldown has elapsed', async () => {
    vi.useFakeTimers();
    try {
      await autoReport({ app: 'piano', reason: 'stall-detector', cooldownMs: 1000 });
      await autoReport({ app: 'piano', reason: 'stall-detector', cooldownMs: 1000 });
      expect(DaylightAPI).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001);
      await autoReport({ app: 'piano', reason: 'stall-detector', cooldownMs: 1000 });
      expect(DaylightAPI).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('caps the number of reports one page load can file, whatever the reasons', async () => {
    for (let i = 0; i < AUTO_REPORT_MAX_PER_SESSION + 5; i += 1) {
       
      await autoReport({ app: 'piano', reason: `reason-${i}` });
    }

    expect(DaylightAPI).toHaveBeenCalledTimes(AUTO_REPORT_MAX_PER_SESSION);
  });

  // ── Never break the caller ──────────────────────────────────────────────

  it('swallows a failed POST — telemetry must not break the surface reporting it', async () => {
    DaylightAPI.mockRejectedValue(new Error('offline'));

    await expect(autoReport({ app: 'piano', reason: 'stall-detector' })).resolves.toBeNull();
  });

  it('does not burn the dedupe slot on a failed POST', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('offline'));
    await autoReport({ app: 'piano', reason: 'stall-detector' });

    DaylightAPI.mockResolvedValue({ id: 'abc' });
    await autoReport({ app: 'piano', reason: 'stall-detector' });

    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });
});
