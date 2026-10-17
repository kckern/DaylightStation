import { describe, it, expect } from 'vitest';
import { buildPlaybackIntervals, projectPlaybackIntervals } from './playbackIntervals.js';
const START = 1800000000000;
const axis = { sessionStartMs: START, effectiveTicks: 201, intervalMs: 5000 };
const media = (start = 0, end = 900000) => ({ type: 'media', data: { contentId: 'video:1', title: 'Episode', start: START + start, end: START + end } });
const ev = (at, state, observation = 'change', run = 'r1') => ({ type: 'playback_state', timestamp: START + at, data: { version: 1, contentId: 'video:1', playbackRunId: run, observation, state, reason: null, evidence: state === 'playing' ? { zone: 'hot', hrBpm: 165 } : null } });
const session = events => ({ timeline: { events } });
const shape = xs => xs.map(x => [x.startMs, x.endMs, x.state]);
describe('saved playback intervals', () => {
  it('uses actual playing boundaries and preserves warning/lock intervals and evidence', () => {
    const xs = buildPlaybackIntervals(session([media(), ev(0,'waiting','begin'), ev(450000,'playing'), ev(690000,'warning'), ev(720000,'governance_paused'), ev(723000,'playing'), ev(800000,'none','end')]), axis);
    expect(shape(xs)).toEqual([[0,450000,'waiting'],[450000,690000,'playing'],[690000,720000,'warning'],[720000,723000,'governance_paused'],[723000,800000,'playing'],[800000,900000,'unknown']]);
    expect(xs.filter(x => x.firstPlaying).map(x => x.startMs)).toEqual([450000]);
    expect(xs[1].evidence.hrBpm).toBe(165);
  });
  it('leaves old sessions and unfinished observation tails unknown, and no-video sessions empty', () => {
    expect(shape(buildPlaybackIntervals(session([media(10000,800000)]), axis))).toEqual([[10000,800000,'unknown']]);
    expect(buildPlaybackIntervals(session([]), axis)).toEqual([]);
    const xs = buildPlaybackIntervals(session([media(), ev(0,'waiting','begin'), ev(450000,'playing'), ev(600000,'warning')]), axis);
    expect(shape(xs)).toEqual([[0,450000,'waiting'],[450000,600000,'playing'],[600000,900000,'unknown']]);
  });
  it('sorts and deduplicates safely, ignores malformed versions/timestamps, and never bridges runs', () => {
    const xs = buildPlaybackIntervals(session([media(), ev(700000,'none','end','r2'),ev(600000,'playing','change','r2'),ev(500000,'unknown','begin','r2'),ev(100000,'none','end'),ev(0,'waiting','begin'),ev(50000,'playing'),ev(50000,'playing'),ev(NaN,'playing'), { ...ev(300000,'playing'), data: { ...ev(300000,'playing').data, version: 99 } }]), axis);
    expect(shape(xs)).toEqual([[0,50000,'waiting'],[50000,100000,'playing'],[100000,500000,'unknown'],[500000,600000,'unknown'],[600000,700000,'playing'],[700000,900000,'unknown']]);
    expect(xs.find(x => x.startMs === 600000).firstPlaying).toBe(false);
  });
  it('compresses grouped gaps with sourceStartMs and clips at seams', () => {
    const grouped = session([media(0,10000), media(610000,620000), ev(0,'waiting','begin'),ev(1000,'playing'),ev(10000,'none','end'),ev(610000,'waiting','begin','r2'),ev(612000,'playing','change','r2'),ev(620000,'none','end','r2')]);
    grouped.segments = [{ sourceStartMs: START, offsetMs: 0, durationMs: 10000 },{ sourceStartMs: START + 610000, offsetMs: 10000, durationMs: 10000 }];
    expect(shape(buildPlaybackIntervals(grouped, { ...axis, effectiveTicks: 5 }))).toEqual([[0,1000,'waiting'],[1000,10000,'playing'],[10000,12000,'waiting'],[12000,20000,'playing']]);
    const projected = projectPlaybackIntervals(buildPlaybackIntervals(grouped, { ...axis, effectiveTicks: 5 }), { effectiveTicks: 5, intervalMs: 5000, plotWidth: 200, marginLeft: 10 });
    expect(projected[2].x).toBe(110);
    expect(projected[2].width).toBe(20);
  });
  it('does not call a partial run a known video start', () => {
    const xs = buildPlaybackIntervals(session([media(),ev(5000,'unknown','begin'),ev(10000,'playing'),ev(20000,'none','end')]), axis);
    expect(xs.find(x => x.state === 'playing').firstPlaying).toBe(false);
  });
});

it('does not extend observed playback beyond an authoritative selected-video end', () => {
  const xs = buildPlaybackIntervals(session([media(10000,60000),ev(0,'waiting','begin'),ev(20000,'playing'),ev(120000,'none','end')]), axis);
  expect(shape(xs)).toEqual([[0,20000,'waiting'],[20000,60000,'playing']]);
});

it('retains closing observations beyond the last chart tick and clips their geometry', () => {
  const xs = buildPlaybackIntervals(session([media(0,1001000), ev(0,'waiting','begin'), ev(1000,'playing'), ev(1001000,'none','end')]), axis);
  expect(shape(xs)).toEqual([[0,1000,'waiting'],[1000,1000000,'playing']]);
});
