import { describe, expect, it, vi } from 'vitest';
import { SchoolAccessGateReader } from './SchoolAccessGateReader.mjs';
import { SchoolTeacherBacklogNudge } from './SchoolTeacherBacklogNudge.mjs';
import { WakeScreenForBroadcast } from '../devices/services/WakeScreenForBroadcast.mjs';
import { RelayStaleAlertService } from '../hardware/RelayStaleAlertService.mjs';
import { PlaybackStallAlertService } from '../devices/services/PlaybackStallAlertService.mjs';
import { WeeklyReviewTranscriptionService } from '../weekly-review/WeeklyReviewTranscriptionService.mjs';

describe('semantic workflows extracted from app composition', () => {
  it('honors forced gate outcomes without consulting presence', () => {
    const readPresence = vi.fn();
    expect(new SchoolAccessGateReader({
      readConfig: () => ({ force: 'open' }), readPresence, clock: { now: () => 1 },
    }).read()).toEqual({ level: 'open', reason: 'forced-open', missing: [], stale: false });
    expect(readPresence).not.toHaveBeenCalled();
  });

  it('preserves screen wake outcome shape', async () => {
    const device = { powerOn: vi.fn(async () => ({ ok: true })), prepareForContent: vi.fn(async () => ({ ok: true })) };
    const service = new WakeScreenForBroadcast({ devices: { get: () => device } });
    await expect(service.execute({ target: 'living-room' })).resolves.toEqual({
      ok: true, power: { ok: true }, foreground: { ok: true },
    });
  });

  it('sends the exact teacher backlog envelope', async () => {
    const send = vi.fn(async () => {});
    const service = new SchoolTeacherBacklogNudge({
      reviewQueue: { listPending: async () => [{}] },
      listPendingPrints: () => [{}, {}],
      reloadSchoolConfig: async () => ({ teachers: ['teacher'] }),
      readCachedSchoolConfig: () => ({}), notifier: { send },
      clock: { today: () => '2026-08-29' }, logger: {},
    });
    await service.execute();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      body: '1 item waiting on a mark and 2 prints awaiting approval — a child may be blocked on you.',
      metadata: { username: 'teacher' }, dedupeKey: 'school-backlog:teacher:2026-08-29',
    }));
  });

  it('keeps watchdog notification envelopes stable', async () => {
    const send = vi.fn(async () => {});
    await new RelayStaleAlertService({
      notifier: { send }, resolveStatusUrl: () => 'http://relay/status',
      formatTimestamp: () => 'then', logger: {},
    }).notify({ label: 'Kitchen relay', silentMs: 7_200_000, lastSeenAt: 5 });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      body: 'Kitchen relay has sent nothing for 2h (last frame then). Check that it has power. Status: http://relay/status',
      dedupeKey: 'relay-stale:Kitchen relay:5',
    }));
    await new PlaybackStallAlertService({ notifier: { send }, logger: {} }).notify({
      deviceId: 'piano', contentId: 'lesson', position: 12.4, stalledForMs: 120_000,
    });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      body: 'piano says it is playing lesson but the playhead has not moved in 2 minutes (stuck at 12s). Someone is probably waiting in front of it.',
      dedupeKey: 'playback-stall:piano:lesson',
    }));
  });

  it('preserves weekly review transcription calls and return shape', async () => {
    const aiGateway = { transcribe: vi.fn(async () => 'raw'), chat: vi.fn(async () => 'clean') };
    const service = new WeeklyReviewTranscriptionService({ aiGateway });
    await expect(service.transcribe(Buffer.from('x'), { mimeType: 'audio/webm', prompt: 'family' }))
      .resolves.toEqual({ transcriptRaw: 'raw', transcriptClean: 'clean' });
    expect(aiGateway.transcribe).toHaveBeenCalledWith(expect.any(Buffer), {
      filename: 'weekly-review.webm', contentType: 'audio/webm', prompt: 'family',
    });
  });
});
