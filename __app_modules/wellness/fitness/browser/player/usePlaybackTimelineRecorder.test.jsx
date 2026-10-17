import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePlaybackTimelineRecorder } from './usePlaybackTimelineRecorder.js';

const makeMedia = () => Object.assign(new EventTarget(), { paused: true, currentTime: 0, ended: false, seeking: false });
const makeSession = () => ({ logEvent: vi.fn() });
const fire = (media, event, paused = media.paused) => act(() => { media.paused = paused; media.dispatchEvent(new Event(event)); });
afterEach(cleanup);
const states = (session) => session.logEvent.mock.calls.map(([, d]) => d.state);

describe('saved playback observer', () => {
  it('requires observed playback, retains warnings, and distinguishes governance/manual/buffering', () => {
    const session = makeSession(); const mediaElement = makeMedia();
    let props = { session, contentId: 'video:1', mediaElement, governance: { status: 'pending', videoLocked: true } };
    const { rerender } = renderHook(p => usePlaybackTimelineRecorder(p), { initialProps: props });
    expect(states(session)).toEqual(['waiting']);
    props = { ...props, governance: { status: 'unlocked', videoLocked: false } }; rerender(props);
    expect(states(session)).not.toContain('playing');
    fire(mediaElement, 'playing', false);
    expect(states(session).at(-1)).toBe('playing');
    props = { ...props, governance: { status: 'warning', videoLocked: false } }; rerender(props);
    expect(states(session).at(-1)).toBe('warning');
    props = { ...props, governance: { status: 'locked', videoLocked: true } }; rerender(props);
    fire(mediaElement, 'pause', true);
    expect(states(session).at(-1)).toBe('governance_paused');
    props = { ...props, governance: { status: 'unlocked' }, pauseDecision: { paused: true, reason: 'PAUSED_USER' } }; rerender(props);
    expect(states(session).at(-1)).toBe('paused');
    props = { ...props, pauseDecision: {}, resilience: { stalled: true } }; rerender(props);
    expect(states(session).at(-1)).toBe('buffering');
    const n = session.logEvent.mock.calls.length; rerender({ ...props });
    expect(session.logEvent).toHaveBeenCalledTimes(n);
    fire(mediaElement, 'waiting');
    expect(states(session).at(-1)).toBe('buffering');
  });
  it('closes runs and rejects stale element events across content changes and remounts', () => {
    const session = makeSession(); const oldMedia = makeMedia(); const newMedia = makeMedia();
    const { rerender, unmount } = renderHook(p => usePlaybackTimelineRecorder(p), { initialProps: { session, contentId: 'video:1', mediaElement: oldMedia } });
    fire(oldMedia, 'playing', false);
    rerender({ session, contentId: 'video:2', mediaElement: newMedia });
    const n = session.logEvent.mock.calls.length; fire(oldMedia, 'pause', true);
    expect(session.logEvent).toHaveBeenCalledTimes(n);
    unmount();
    const events = session.logEvent.mock.calls.map(([, d]) => d);
    expect(events.filter(e => e.observation === 'end')).toHaveLength(2);
    expect(new Set(events.filter(e => e.observation === 'begin').map(e => e.playbackRunId)).size).toBe(2);
    const endCount = session.logEvent.mock.calls.length; fire(newMedia, 'playing', false);
    expect(session.logEvent).toHaveBeenCalledTimes(endCount);
  });
  it('copies historical evidence and keeps a voice memo hold paused after unlock', () => {
    const session = makeSession(); const mediaElement = makeMedia();
    const evidence = { participantId: 'child', zone: 'hot', hrBpm: 165, thresholdBpm: 160, challengeId: null };
    const props = { session, contentId: 'video:1', mediaElement, governance: { status: 'unlocked' }, evidence, pauseDecision: { holdReason: 'voice_memo' } };
    const { rerender } = renderHook(p => usePlaybackTimelineRecorder(p), { initialProps: props });
    expect(states(session)).toEqual(['paused']);
    const saved = session.logEvent.mock.calls[0][1]; evidence.hrBpm = 90;
    expect(saved.evidence.hrBpm).toBe(165);
    rerender({ ...props, pauseDecision: {} }); fire(mediaElement, 'playing', false);
    expect(states(session).at(-1)).toBe('playing');
  });
});
