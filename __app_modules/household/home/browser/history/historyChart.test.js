import { describe, it, expect } from 'vitest';
import { buildHistoryChartOptions, formatAxisTime } from './historyChart.js';

const tokens = { textMid: '#9', textLow: '#6', border: '#2', surface: '#1', accent: '#a', warning: '#w', info: '#i' };
describe('buildHistoryChartOptions', () => {
  it('waits for tokens', () => { expect(buildHistoryChartOptions({ history: { kind: 'line', points: [] }, tokens: null })).toBeNull(); });
  it('a reading is an area with gaps kept', () => {
    const o = buildHistoryChartOptions({ history: { kind: 'line', points: [{ t: 1, v: 5, max: 6 }, { t: 2, v: null, max: null }] }, tokens, unit: 'W' });
    expect(o.series[0]).toMatchObject({ type: 'area', data: [[1, 5], [2, null]], connectNulls: false, color: '#a' });
    expect(o.yAxis.labels.formatter.call({ value: 5 })).toBe('5 W');
  });
  it('on/off is a stepped 0/1 band; rings are marks', () => {
    const s = buildHistoryChartOptions({ history: { kind: 'state', sinceIso: '1970-01-01T00:00:00.000Z', endIso: '1970-01-01T00:00:10.000Z', intervals: [{ from: 2000, to: 5000 }] }, tokens });
    expect(s.series[0]).toMatchObject({ type: 'area', step: 'left', color: '#w' });
    expect(s.series[0].data).toEqual([[0, 0], [2000, 1], [5000, 0], [10000, 0]]);
    // On is amber, solid: a translucent amber over a dark panel reads olive.
    expect(s.series[0]).toMatchObject({ fillColor: '#w', fillOpacity: 1 });
    expect(s.yAxis.visible).toBe(false);
    const e = buildHistoryChartOptions({ history: { kind: 'events', marks: [3000] }, tokens });
    expect(e.series[0]).toMatchObject({ type: 'scatter', data: [[3000, 0]], color: '#i' });
  });
  it('an interval still open at the end of the window stays on to the end', () => {
    const s = buildHistoryChartOptions({ history: { kind: 'state', sinceIso: '1970-01-01T00:00:00.000Z', endIso: '1970-01-01T00:00:10.000Z', intervals: [{ from: 0, to: 10000 }] }, tokens });
    expect(s.series[0].data).toEqual([[0, 1], [10000, 1]]);
  });
  it('local time, no legend, credits or title', () => {
    const o = buildHistoryChartOptions({ history: { kind: 'line', points: [] }, tokens, height: 120 });
    expect(o.time).toEqual({ useUTC: false });
    expect(o.xAxis.type).toBe('datetime');
    expect(o.legend.enabled).toBe(false);
    expect(o.credits.enabled).toBe(false);
    expect(o.title.text).toBeNull();
    expect(o.chart.height).toBe(120);
  });
  it('names the household zone when the history carries one, else stays on browser time', () => {
    const o = buildHistoryChartOptions({ history: { kind: 'line', points: [], timeZone: 'America/Los_Angeles' }, tokens });
    expect(o.time).toEqual({ timezone: 'America/Los_Angeles' });
  });
  it('x-axis labels speak the page\'s clock: "6 pm", "6:30 pm", "Wed 28", in the household zone', () => {
    const tz = 'America/Los_Angeles';
    expect(formatAxisTime(Date.parse('2026-10-29T01:00:00Z'), 'hour', tz)).toBe('6 pm');
    expect(formatAxisTime(Date.parse('2026-10-29T01:30:00Z'), 'minute', tz)).toBe('6:30 pm');
    expect(formatAxisTime(Date.parse('2026-10-28T07:00:00Z'), 'day', tz)).toBe('Wed 28');
    // At a local midnight inside an hourly axis the day is the label, not "12 am".
    expect(formatAxisTime(Date.parse('2026-10-28T07:00:00Z'), 'hour', tz)).toBe('Wed 28');
    const o = buildHistoryChartOptions({ history: { kind: 'line', points: [], timeZone: tz }, tokens });
    expect(o.xAxis.labels.formatter.call({ value: Date.parse('2026-10-29T01:00:00Z'), tickPositionInfo: { unitName: 'hour' } })).toBe('6 pm');
  });
  it('a watts y-axis reads in W and kW, not 10000 W', () => {
    const o = buildHistoryChartOptions({ history: { kind: 'line', points: [] }, tokens, unit: 'W' });
    expect(o.yAxis.labels.formatter.call({ value: 10000 })).toBe('10 kW');
    expect(o.yAxis.labels.formatter.call({ value: 500 })).toBe('500 W');
    const t = buildHistoryChartOptions({ history: { kind: 'line', points: [] }, tokens, unit: '°F' });
    expect(t.yAxis.labels.formatter.call({ value: 70 })).toBe('70 °F');
  });
});
