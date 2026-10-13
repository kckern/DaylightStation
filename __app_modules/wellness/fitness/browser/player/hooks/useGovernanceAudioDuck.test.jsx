import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({ DaylightMediaPath: (p) => p }));
const warn = vi.fn();
const info = vi.fn();
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: (...a) => info(...a), warn: (...a) => warn(...a), error: noop, sampled: noop };
  return { default: () => logger };
});

import { useGovernanceAudioDuck, playCueOnce } from "./useGovernanceAudioDuck.js";
import { createCycleAudioEngine } from "../../../../../../tests/_fixtures/fitness/cycleAudioEngine.mjs";
import { __resetCueAudioForTest } from "./audioCuePlayer.js";

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src; this.paused = true; this.playCalls = 0; this.pauseCalls = 0; this._l = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(e, cb) { (this._l[e] ||= []).push(cb); }
  removeEventListener(e, cb) { this._l[e] = (this._l[e] || []).filter((f) => f !== cb); }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls += 1; this.paused = true; }
  fire(e) { (this._l[e] || []).forEach((cb) => cb()); }
}

const descriptor = (o = {}) => ({
  cueId: 'challenge_hurry', sound: 'apps/fitness/ux/challenge-hurry.mp3',
  duckTo: 0.1, token: 'ch1:challenge_hurry', trigger: 'challenge_remaining', ...o,
});

describe('useGovernanceAudioDuck', () => {
  let videoVolume;
  beforeEach(() => {
    FakeAudio.instances = [];
    global.Audio = FakeAudio;
    __resetCueAudioForTest();
    videoVolume = { setDuck: vi.fn(), volumeRef: { current: 1 } };
  });
  afterEach(() => vi.restoreAllMocks());

  const render = (audioDuck, lifecycle = {}) =>
    renderHook((props) => useGovernanceAudioDuck({ videoVolume, ...props }), {
      initialProps: { audioDuck, ...lifecycle },
    });

  it('ducks (via setDuck) and plays the SFX on a new token', () => {
    render(descriptor());
    expect(videoVolume.setDuck).toHaveBeenCalledWith(0.1);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it('does NOT re-duck or cut the SFX when the descriptor object changes but the token is unchanged', () => {
    const { rerender } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    for (let i = 0; i < 3; i++) rerender({ audioDuck: descriptor() });
    expect(videoVolume.setDuck).toHaveBeenCalledTimes(1);
    expect(sfx.pauseCalls).toBe(0);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('lifts the duck (setDuck(1)) when the SFX ends', () => {
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('ended'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('lifts the duck if autoplay rejects', async () => {
    global.Audio = class extends FakeAudio { play() { this.playCalls += 1; return Promise.reject(new Error('blocked')); } };
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('reuses one shared element and re-ducks on a new token', () => {
    const { rerender } = render(descriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start', duckTo: 0.2 }));
    rerender({ audioDuck: descriptor({ token: 'ch1:challenge_hurry', duckTo: 0.1 }) });
    expect(FakeAudio.instances).toHaveLength(1);        // shared element, not recreated
    expect(FakeAudio.instances[0].playCalls).toBe(2);   // played again for the new cue
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.1);
  });

  it('explicit suppression mid-cue stops its SFX and lifts the active governance duck once', () => {
    const { rerender, unmount } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null, suppress: true });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
    expect(sfx.pauseCalls).toBe(1);
    expect(sfx.paused).toBe(true);
    expect(sfx._l.ended).toEqual([]);
    expect(sfx._l.error).toEqual([]);
    rerender({ audioDuck: null, suppress: true });
    unmount();
    expect(sfx.pauseCalls).toBe(1);
  });

  it('suppressing an active governance duck does not pause a superseding success cue on the shared element', () => {
    const { rerender } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    const onDone = vi.fn();
    act(() => playCueOnce({ sound: 'success.mp3', onDone }));
    rerender({ audioDuck: null, suppress: true });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
    expect(sfx.src).toBe('/media/success.mp3');
    expect(sfx.paused).toBe(false);
    expect(sfx.pauseCalls).toBe(0);
    act(() => sfx.fire('ended'));
    expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
    expect(videoVolume.setDuck).toHaveBeenCalledTimes(2);
  });

  it('suppressing a completed governance cue leaves later playback on the shared element alone', () => {
    const { rerender } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    act(() => sfx.fire('ended'));
    sfx.play(); // a later shared-element owner, after governance has lifted its duck
    rerender({ audioDuck: null, suppress: true });
    expect(sfx.paused).toBe(false);
    expect(sfx.pauseCalls).toBe(0);
    expect(sfx._l.ended).toEqual([]);
    expect(sfx._l.error).toEqual([]);
    expect(videoVolume.setDuck).toHaveBeenCalledTimes(2);
  });

  it('suppression with no governance session does not pause audio owned elsewhere', () => {
    const { rerender } = render(null);
    const independentAudio = new FakeAudio('independent-voice-memo.mp3');
    independentAudio.play();
    rerender({ audioDuck: null, suppress: true });
    expect(independentAudio.paused).toBe(false);
    expect(independentAudio.pauseCalls).toBe(0);
    expect(videoVolume.setDuck).not.toHaveBeenCalled();
  });

  it.each([
    ['cycle_start', 'cycle_challenge_init'], ['cycle_fail', 'cycle_locked'],
    ['cycle_end', 'cycle_success'], ['cycle_hurry', null],
  ])('real-engine %s event keeps playing through later null ticks until ended', (cueId, cycleAudioCue) => {
    const { engine } = createCycleAudioEngine();
    const snapshot = { type: 'cycle', id: 'ordinary-cycle', status: 'pending', cycleState: 'maintain',
      cycleAudioCue, currentRpm: cycleAudioCue ? 80 : 40, currentPhase: { loRpm: 60 }, cycleHealthPct: 0.5 };
    const first = engine._computeAudioDuck(snapshot);
    expect(first.cueId).toBe(cueId);
    const { rerender } = render(first);
    const sfx = FakeAudio.instances[0];
    const next = engine._computeAudioDuck({ ...snapshot, cycleAudioCue: null, currentRpm: cycleAudioCue ? 80 : 40 });
    expect(next).toBeNull();
    rerender({ audioDuck: next });
    rerender({ audioDuck: next });
    expect(sfx.paused).toBe(false);
    expect(sfx.pauseCalls).toBe(0);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(first.duckTo);
    act(() => sfx.fire('ended'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('item identity changes cancel the old active cue once without replaying its token', () => {
    const { rerender } = render(descriptor(), { itemKey: 'video-1' });
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null, itemKey: 'video-2' });
    expect(sfx.paused).toBe(true);
    expect(sfx.pauseCalls).toBe(1);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
    rerender({ audioDuck: descriptor(), itemKey: 'video-2' });
    expect(sfx.playCalls).toBe(1);
  });

  it('real-engine recovery cancels the ongoing cycle cue once and emits no effort warning', () => {
    const f = createCycleAudioEngine();
    const first = f.start();
    expect(first.audioDuck.cueId).toBe('cycle_start');
    const { rerender } = render(first.audioDuck);
    const sfx = FakeAudio.instances[0];
    const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; active._publishedCycleState = 'maintain'; active.cycleHealthMs = 1500;
    const recovery = f.tick(2700, null);
    expect(recovery.challenge.sensorUnavailable).toBe(true);
    expect(recovery.audioDuck).toBeNull();
    rerender({ audioDuck: recovery.audioDuck, suppressCycle: recovery.challenge.sensorUnavailable });
    expect(sfx.paused).toBe(true);
    expect(sfx.pauseCalls).toBe(1);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
    const next = f.tick(200, null);
    rerender({ audioDuck: next.audioDuck, suppressCycle: next.challenge.sensorUnavailable });
    expect(sfx.pauseCalls).toBe(1);
    expect(sfx.playCalls).toBe(1);
  });

  it('real-engine HR warning plays and remains active during the same cycle recovery', () => {
    const f = createCycleAudioEngine();
    const first = f.start();
    const { rerender } = render(first.audioDuck);
    const sfx = FakeAudio.instances[0];
    const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; active._publishedCycleState = 'maintain'; active.cycleHealthMs = 1500;
    const warning = f.tick(2700, null, 'cool');
    expect(warning.status).toBe('warning');
    expect(warning.challenge.sensorUnavailable).toBe(true);
    expect(warning.audioDuck.cueId).toBe('hr_warning');
    rerender({ audioDuck: warning.audioDuck, suppressCycle: true });
    expect(sfx.src).toBe('/media/warning.mp3');
    expect(sfx.paused).toBe(false);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.15);
    const next = f.tick(200, null, 'cool');
    rerender({ audioDuck: next.audioDuck, suppressCycle: true });
    expect(sfx.pauseCalls).toBe(1); // previous cycle session only
    expect(sfx.playCalls).toBe(2);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.15);
    act(() => sfx.fire('ended'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it.each(['sensor recovery', 'item change'])('%s cancels its cycle duck while leaving a superseding success cue playing', (cause) => {
    const first = createCycleAudioEngine().start();
    const { rerender } = render(first.audioDuck, { itemKey: 'video-1' });
    const sfx = FakeAudio.instances[0];
    const onDone = vi.fn();
    act(() => playCueOnce({ sound: 'success.mp3', onDone }));
    rerender({ audioDuck: null, itemKey: cause === 'item change' ? 'video-2' : 'video-1',
      suppressCycle: cause === 'sensor recovery' });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
    expect(sfx.paused).toBe(false);
    expect(sfx.pauseCalls).toBe(0);
    act(() => sfx.fire('ended'));
    expect(onDone).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('cycle-only suppression does not interrupt an already-playing base HR cue', () => {
    const warning = descriptor({ trigger: 'governance_warning' });
    const { rerender } = render(warning);
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null, suppressCycle: true });
    expect(sfx.paused).toBe(false);
    expect(sfx.pauseCalls).toBe(0);
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.1);
  });

  it('lifts the duck on unmount mid-cue', () => {
    const { unmount } = render(descriptor());
    unmount();
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('logs the rejection reason when play() is rejected', async () => {
    warn.mockClear();
    global.Audio = class extends FakeAudio {
      play() { this.playCalls += 1; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
    };
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(warn).toHaveBeenCalledWith('fitness.audio_duck.play_rejected',
      expect.objectContaining({ cueId: 'challenge_hurry', name: 'NotAllowedError' }));
  });

  it('logs + lifts the duck when the audio element fires error', () => {
    warn.mockClear();
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('error'));
    expect(warn).toHaveBeenCalledWith('fitness.audio_duck.error', expect.objectContaining({ cueId: 'challenge_hurry' }));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('does NOT lift the duck on an aborted media error (superseded load)', () => {
    render(descriptor());
    videoVolume.setDuck.mockClear();
    const el = FakeAudio.instances[0];
    el.error = { code: 1, message: 'aborted' };
    act(() => el.fire('error'));
    // duck must NOT be lifted (no setDuck(1) call) for an aborted load
    expect(videoVolume.setDuck).not.toHaveBeenCalledWith(1);
  });

  it('lifts the duck on a real media error (code 4)', () => {
    render(descriptor());
    const el = FakeAudio.instances[0];
    el.error = { code: 4, message: 'src not supported' };
    act(() => el.fire('error'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('end reason is "ended" on natural completion', () => {
    info.mockClear();
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('ended'));
    expect(info).toHaveBeenCalledWith('fitness.audio_duck.end', expect.objectContaining({ reason: 'ended' }));
  });

  it('end reason is "rejected" when play() is rejected', async () => {
    info.mockClear();
    global.Audio = class extends FakeAudio { play() { this.playCalls += 1; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); } };
    __resetCueAudioForTest();
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(info).toHaveBeenCalledWith('fitness.audio_duck.end', expect.objectContaining({ reason: 'rejected' }));
  });

  it('end reason is "error" on a real media error', () => {
    info.mockClear();
    render(descriptor());
    const el = FakeAudio.instances[0];
    el.error = { code: 4, message: 'unsupported' };
    act(() => el.fire('error'));
    expect(info).toHaveBeenCalledWith('fitness.audio_duck.end', expect.objectContaining({ reason: 'error' }));
  });

  it('end reason is "superseded" when a new token replaces the current cue', () => {
    const { rerender } = render(descriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start', duckTo: 0.2 }));
    info.mockClear();
    rerender({ audioDuck: descriptor({ token: 'ch1:challenge_hurry', duckTo: 0.1 }) });
    expect(info).toHaveBeenCalledWith('fitness.audio_duck.end', expect.objectContaining({ reason: 'superseded' }));
  });

  it('end reason is "unmount" when unmounted mid-cue', () => {
    const { unmount } = render(descriptor());
    info.mockClear();
    unmount();
    expect(info).toHaveBeenCalledWith('fitness.audio_duck.end', expect.objectContaining({ reason: 'unmount' }));
  });

  it('applies the descriptor volume to the SFX element', () => {
    render(descriptor({ volume: 0.6 }));
    expect(FakeAudio.instances[0].volume).toBe(0.6);
  });

  it('defaults the SFX volume to 1 when no volume is given', () => {
    render(descriptor());
    expect(FakeAudio.instances[0].volume).toBe(1);
  });

  it('does not replay a stage token after an interposed warning token (A → B → A)', () => {
    const start = descriptor({ token: 'ch1:c_start', cueId: 'challenge_start', duckTo: 0.2 });
    const { rerender } = render(start);
    const sfx = FakeAudio.instances[0];
    expect(sfx.playCalls).toBe(1);
    rerender({ audioDuck: descriptor({ token: 'c_warn:5000', cueId: 'governance_warning', duckTo: 0.15 }) });
    expect(sfx.playCalls).toBe(2);          // warning episode plays
    rerender({ audioDuck: start });         // back to green: same stage token returns
    expect(sfx.playCalls).toBe(2);          // no start-sound replay
  });

  it('does not replay after a token → null → same-token round trip (lock gap)', () => {
    const start = descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' });
    const { rerender } = render(start);
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });          // engine emits nothing while locked
    rerender({ audioDuck: start });         // unlock: stage token returns
    expect(sfx.playCalls).toBe(1);
  });

  it('still plays a genuinely new token after suppressed replays', () => {
    const { rerender } = render(descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' }));
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });
    rerender({ audioDuck: descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' }) }); // suppressed
    rerender({ audioDuck: descriptor({ token: 'ch1:c_hurry', cueId: 'challenge_hurry' }) }); // new stage
    expect(sfx.playCalls).toBe(2);
  });

  it('warning episodes with distinct timestamps still replay (episode tokens stay unique)', () => {
    const { rerender } = render(descriptor({ token: 'c_warn:5000', cueId: 'governance_warning' }));
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });
    rerender({ audioDuck: descriptor({ token: 'c_warn:9000', cueId: 'governance_warning' }) });
    expect(sfx.playCalls).toBe(2);
  });
});
