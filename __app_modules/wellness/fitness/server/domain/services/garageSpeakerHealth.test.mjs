import { describe, it, expect } from 'vitest';
import { normalizeGarageSpeakerReport, GARAGE_SPEAKER_EVENTS } from './garageSpeakerHealth.mjs';

describe('normalizeGarageSpeakerReport', () => {
  it('accepts every recovery step with its log level', () => {
    expect(GARAGE_SPEAKER_EVENTS).toEqual({ dropout: 'warn', power_cycle: 'warn', recovered: 'info', gave_up: 'error' });
    const report = normalizeGarageSpeakerReport({ event: 'dropout', powerW: '0.1', currentA: 0.01, durationS: '27.4', cyclesLastHour: '1' });
    expect(report).toEqual({
      ok: true, event: 'dropout', level: 'warn',
      data: { powerW: 0.1, currentA: 0.01, durationS: 27.4, cycle: null, cyclesLastHour: 1, reason: null, haContextId: null },
    });
  });

  it('coerces HA template output: unknown/unavailable numbers become null', () => {
    const { data } = normalizeGarageSpeakerReport({ event: 'recovered', powerW: 'unavailable', currentA: '', durationS: null, cycle: '2.0' });
    expect(data).toMatchObject({ powerW: null, currentA: null, durationS: null, cycle: 2 });
  });

  it('requires a known reason for gave_up', () => {
    expect(normalizeGarageSpeakerReport({ event: 'gave_up' })).toEqual({ ok: false, reason: 'invalid_gave_up_reason' });
    expect(normalizeGarageSpeakerReport({ event: 'gave_up', reason: 'cap_reached' }).data.reason).toBe('cap_reached');
    expect(normalizeGarageSpeakerReport({ event: 'dropout', reason: 'cap_reached' }).data.reason).toBeNull();
  });

  it('rejects unknown events and malformed bodies', () => {
    expect(normalizeGarageSpeakerReport({ event: 'toString' })).toEqual({ ok: false, reason: 'unknown_event' });
    expect(normalizeGarageSpeakerReport({ event: 'reboot' })).toEqual({ ok: false, reason: 'unknown_event' });
    expect(normalizeGarageSpeakerReport(null)).toEqual({ ok: false, reason: 'invalid_body' });
    expect(normalizeGarageSpeakerReport(['dropout'])).toEqual({ ok: false, reason: 'invalid_body' });
  });
});
