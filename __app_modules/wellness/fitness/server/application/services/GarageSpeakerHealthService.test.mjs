import { describe, it, expect, vi } from 'vitest';
import { GarageSpeakerHealthService } from './GarageSpeakerHealthService.mjs';

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('GarageSpeakerHealthService', () => {
  it('logs each step at its level, attached to the live fitness session', () => {
    const logger = makeLogger();
    const liveSessionAuthority = { current: vi.fn().mockReturnValue('fs_20261023162522') };
    const service = new GarageSpeakerHealthService({ logger, liveSessionAuthority });

    expect(service.record({ event: 'power_cycle', powerW: 0, durationS: 26, cycle: 1, cyclesLastHour: 0 }, 'default'))
      .toEqual({ ok: true, event: 'fitness.garage_speaker.power_cycle', sessionId: 'fs_20261023162522' });
    expect(liveSessionAuthority.current).toHaveBeenCalledWith('default');
    expect(logger.warn).toHaveBeenCalledWith('fitness.garage_speaker.power_cycle', expect.objectContaining({
      powerW: 0, durationS: 26, cycle: 1, cyclesLastHour: 0, sessionId: 'fs_20261023162522',
    }));

    service.record({ event: 'recovered', powerW: 9.5 });
    expect(logger.info).toHaveBeenCalledWith('fitness.garage_speaker.recovered', expect.objectContaining({ powerW: 9.5 }));
    service.record({ event: 'gave_up', reason: 'no_power_after_cycle' });
    expect(logger.error).toHaveBeenCalledWith('fitness.garage_speaker.gave_up', expect.objectContaining({ reason: 'no_power_after_cycle' }));
  });

  it('records with a null session when nothing is live', () => {
    const logger = makeLogger();
    const service = new GarageSpeakerHealthService({ logger });
    expect(service.record({ event: 'dropout' }).sessionId).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('fitness.garage_speaker.dropout', expect.objectContaining({ sessionId: null }));
  });

  it('logs a rejected report instead of a speaker event', () => {
    const logger = makeLogger();
    const service = new GarageSpeakerHealthService({ logger });
    expect(service.record({ event: 'explode' })).toEqual({ ok: false, reason: 'unknown_event' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('fitness.garage_speaker.report_rejected', { reason: 'unknown_event', event: 'explode' });
  });

  it('pushes the phone when recovery gives up, and still answers if the push fails', async () => {
    const logger = makeLogger();
    const sendPush = vi.fn().mockRejectedValue(new Error('ha down'));
    const service = new GarageSpeakerHealthService({ logger, sendPush });
    expect(service.record({ event: 'gave_up', reason: 'cap_reached', cyclesLastHour: 2 }).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: '🔇 Garage speaker out', data: expect.objectContaining({ tag: 'garage-speaker-recovery' }) }));
    expect(logger.warn).toHaveBeenCalledWith('fitness.garage_speaker.push_failed', { error: 'ha down' });
  });

  it('does not push for steps that are not a give-up', async () => {
    const sendPush = vi.fn();
    const service = new GarageSpeakerHealthService({ logger: makeLogger(), sendPush });
    service.record({ event: 'dropout' });
    service.record({ event: 'power_cycle', cycle: 1 });
    service.record({ event: 'recovered' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendPush).not.toHaveBeenCalled();
  });
});
