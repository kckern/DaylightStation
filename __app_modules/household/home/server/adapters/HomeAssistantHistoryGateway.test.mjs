import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantHistoryGateway } from './HomeAssistantHistoryGateway.mjs';

const make = (map) => {
  const gateway = { getHistory: vi.fn().mockResolvedValue(map) };
  const logger = { warn: vi.fn(), debug: vi.fn() };
  return { gw: new HomeAssistantHistoryGateway({}, { gateway, logger }), gateway, logger };
};

describe('HomeAssistantHistoryGateway', () => {
  it('translates times to ms and platform non-values to null', async () => {
    const { gw } = make(new Map([['sensor.p', [{ t: '2026-10-28T07:00:00Z', v: 5 }, { t: '2026-10-28T07:01:00Z', v: 'unavailable' }, { t: 'bad', v: 1 }]]]));
    const out = await gw.readHistory(['sensor.p'], { startMs: Date.parse('2026-10-28T07:00:00Z'), endMs: null });
    expect(out.get('sensor.p')).toEqual([{ t: Date.parse('2026-10-28T07:00:00Z'), v: 5 }, { t: Date.parse('2026-10-28T07:01:00Z'), v: null }]);
  });
  it('an open window runs to the next whole minute: the platform would end it one day after the start', async () => {
    const gateway = { getHistory: vi.fn().mockResolvedValue(new Map()) };
    let now = Date.parse('2026-10-28T19:34:29.500Z');
    const gw = new HomeAssistantHistoryGateway({}, { gateway, logger: { warn: vi.fn() }, clock: () => now });
    const weekAgo = now - 7 * 864e5;
    await gw.readHistory(['a.b'], { startMs: weekAgo, endMs: null });
    now += 20e3; // same minute: the same request, so the platform cache key holds
    await gw.readHistory(['a.b'], { startMs: weekAgo, endMs: null });
    await gw.readHistory(['a.b'], { startMs: 0, endMs: 3600e3 });
    expect(gateway.getHistory.mock.calls[0][1]).toEqual({ sinceIso: new Date(weekAgo).toISOString(), endIso: '2026-10-28T19:35:00.000Z' });
    expect(gateway.getHistory.mock.calls[1][1]).toEqual(gateway.getHistory.mock.calls[0][1]);
    expect(gateway.getHistory.mock.calls[2][1]).toEqual({ sinceIso: '1970-01-01T00:00:00.000Z', endIso: '1970-01-01T01:00:00.000Z' });
  });
  it('now exactly on a minute still ends at the NEXT minute, never at now itself', async () => {
    const gateway = { getHistory: vi.fn().mockResolvedValue(new Map()) };
    const now = Date.parse('2026-10-28T19:35:00.000Z');
    const gw = new HomeAssistantHistoryGateway({}, { gateway, logger: { warn: vi.fn() }, clock: () => now });
    await gw.readHistory(['a.b'], { startMs: now - 864e5, endMs: null });
    expect(gateway.getHistory.mock.calls[0][1].endIso).toBe('2026-10-28T19:36:00.000Z');
  });
  it('warns when the platform returns nothing for a real request', async () => {
    const { gw, logger } = make(new Map());
    expect((await gw.readHistory(['a.b'], { startMs: 0, endMs: null })).size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('home.history.empty', { entities: 1 });
  });
  it('requires its gateway', () => {
    expect(() => new HomeAssistantHistoryGateway({}, {})).toThrow(/requires gateway/);
  });
  it('without an injected logger it stays silent rather than writing to the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gw = new HomeAssistantHistoryGateway({}, { gateway: { getHistory: vi.fn().mockResolvedValue(new Map()) } });
    await gw.readHistory(['sensor.p'], { startMs: 0, endMs: 1 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
