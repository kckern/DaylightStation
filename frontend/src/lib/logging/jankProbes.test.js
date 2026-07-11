import { describe, it, expect, afterEach } from 'vitest';
import {
  reportRender,
  readRenderRegistry,
  readJankProbes,
  stopJankProbes,
} from './jankProbes.js';

afterEach(() => stopJankProbes());

describe('render registry', () => {
  it('returns null when nothing has reported', () => {
    expect(readRenderRegistry()).toBeNull();
  });

  it('counts commits per component and records the latest node count', () => {
    reportRender('NoteWaterfall', { nodes: 12 });
    reportRender('NoteWaterfall', { nodes: 40 });
    reportRender('PianoKeyboard');
    const reg = readRenderRegistry();
    expect(reg.NoteWaterfall).toEqual({ count: 2, nodes: 40 });
    expect(reg.PianoKeyboard).toEqual({ count: 1, nodes: 0 });
  });

  it('resets the per-window commit count on read but keeps last-known nodes', () => {
    reportRender('NoteWaterfall', { nodes: 40 });
    readRenderRegistry();
    reportRender('NoteWaterfall'); // a commit with no node count reported
    const reg = readRenderRegistry();
    expect(reg.NoteWaterfall).toEqual({ count: 1, nodes: 40 });
  });
});

describe('readJankProbes', () => {
  it('reports zeroed accumulators before any observed activity', () => {
    const p = readJankProbes();
    expect(p.longTasks).toEqual({ count: 0, totalMs: 0, maxMs: 0 });
    expect(p.slowEvents).toEqual({ count: 0, maxMs: 0 });
    expect(p.loopLag).toEqual({ curMs: 0, maxMs: 0 });
  });

  it('always returns a stable shape', () => {
    const p = readJankProbes();
    expect(p).toHaveProperty('loopLag.curMs');
    expect(p).toHaveProperty('loopLag.maxMs');
    expect(p).toHaveProperty('longTasks.count');
    expect(p).toHaveProperty('slowEvents.count');
  });
});
