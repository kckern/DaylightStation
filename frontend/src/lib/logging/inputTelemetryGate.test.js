import { describe, it, expect } from 'vitest';
import { inputTelemetryEnabled, makeInputSender } from './inputTelemetryGate.js';
describe('input telemetry gate', () => {
  it('gate reads the top-level flag regardless of mode', () => {
    expect(inputTelemetryEnabled({ inputTelemetry: { enabled: true } }, 'composer')).toBe(true);
    expect(inputTelemetryEnabled({ inputTelemetry: { enabled: true } }, 'sheetmusic')).toBe(true);
    expect(inputTelemetryEnabled({}, 'composer')).toBe(false);
    expect(inputTelemetryEnabled(null, 'composer')).toBe(false);
  });
  it('a mode-nested flag arms ONLY the matching mode', () => {
    // The whole point of the `mode` param: piano.yml `composer.inputTelemetry`
    // must NOT also ship SheetMusic (which passes the full piano config +
    // mode 'sheetmusic'). Before the mode param the `.composer` branch matched
    // for both modes and SheetMusic shipped unasked.
    const cfg = { composer: { inputTelemetry: { enabled: true } } };
    expect(inputTelemetryEnabled(cfg, 'composer')).toBe(true);
    expect(inputTelemetryEnabled(cfg, 'sheetmusic')).toBe(false);
    const sm = { sheetmusic: { inputTelemetry: { enabled: true } } };
    expect(inputTelemetryEnabled(sm, 'sheetmusic')).toBe(true);
    expect(inputTelemetryEnabled(sm, 'composer')).toBe(false);
  });
  it('sender tags app + input channel, one event per call', () => {
    const calls = []; const fakeLogger = { info: (e, d, o) => calls.push({ e, d, o }) };
    const send = makeInputSender('piano-composer', () => fakeLogger);
    send({ h: 1 }); send({ b: [] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ e: 'input.header', o: { context: { app: 'piano-composer', channel: 'input' } } });
    expect(calls[1].e).toBe('input.batch');
  });
});
