import { describe, it, expect } from 'vitest';
import { inputTelemetryEnabled, makeInputSender } from './inputTelemetryGate.js';
describe('input telemetry gate', () => {
  it('gate reads nested flags', () => {
    expect(inputTelemetryEnabled({ inputTelemetry: { enabled: true } })).toBe(true);
    expect(inputTelemetryEnabled({ composer: { inputTelemetry: { enabled: true } } })).toBe(true);
    expect(inputTelemetryEnabled({ sheetmusic: { inputTelemetry: { enabled: true } } })).toBe(true);
    expect(inputTelemetryEnabled({})).toBe(false);
    expect(inputTelemetryEnabled(null)).toBe(false);
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
