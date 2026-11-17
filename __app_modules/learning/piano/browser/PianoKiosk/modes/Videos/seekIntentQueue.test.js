import { describe, it, expect, vi } from 'vitest';
import { createSeekIntentQueue } from './seekIntentQueue.js';

function fixture() {
  let time = 0;
  let id = 0;
  const queueTimers = new Map();
  const seek = vi.fn();
  const queue = createSeekIntentQueue({ seek, now: () => time,
    setTimer: (fn) => { queueTimers.set(++id, fn); return id; },
    clearTimer: (key) => queueTimers.delete(key),
  });
  queue.reset('video-a');
  return { queue, seek, queueTimers, elapse: (ms) => { time += ms; } };
}

describe('seek intent queue', () => {
  it('coalesces repeated requests behind one in-flight seek', () => {
    const { queue, seek } = fixture();
    for (const target of [15, 30, 45, 60]) queue.request({ mediaKey: 'video-a', target });
    expect(seek).toHaveBeenCalledTimes(1);
    queue.complete({ mediaKey: 'video-a' });
    expect(seek).toHaveBeenLastCalledWith(expect.objectContaining({ target: 60 }));
    expect(seek).toHaveBeenCalledTimes(2);
  });

  it('old media callbacks cannot seek the next video', () => {
    const { queue, seek: newVideoSeek } = fixture();
    queue.request({ mediaKey: 'video-a', target: 30 });
    queue.request({ mediaKey: 'video-a', target: 60 });
    queue.reset('video-b');
    newVideoSeek.mockClear();
    queue.complete({ mediaKey: 'video-a' });
    queue.request({ mediaKey: 'video-a', target: 90 });
    expect(newVideoSeek).not.toHaveBeenCalled();
  });

  it('timeout and unmount clear pending work', () => {
    const { queue, seek, queueTimers, elapse } = fixture();
    queue.request({ mediaKey: 'video-a', target: 30 });
    queue.request({ mediaKey: 'video-a', target: 60 });
    elapse(5000);
    for (const fn of [...queueTimers.values()]) fn();
    queue.complete({ mediaKey: 'video-a' });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(queueTimers.size).toBe(0);
    queue.request({ mediaKey: 'video-a', target: 10 });
    queue.request({ mediaKey: 'video-a', target: 0 });
    queue.dispose();
    queue.complete({ mediaKey: 'video-a' });
    queue.request({ mediaKey: 'video-a', target: 60 });
    expect(seek).toHaveBeenCalledTimes(2);
    expect(queueTimers.size).toBe(0);
  });

  it('restart replaces the pending target and an expired completion cannot flush it', () => {
    const { queue, seek, elapse } = fixture();
    queue.request({ mediaKey: 'video-a', target: 30 });
    queue.request({ mediaKey: 'video-a', target: 60 });
    queue.request({ mediaKey: 'video-a', target: 0 });
    queue.complete({ mediaKey: 'video-a' });
    expect(seek.mock.calls.map(([intent]) => intent.target)).toEqual([30, 0]);
    queue.request({ mediaKey: 'video-a', target: 15 });
    elapse(5000);
    queue.complete({ mediaKey: 'video-a' });
    expect(seek).toHaveBeenCalledTimes(2);
  });
});


it('a cancelled timeout cannot clear a later attempt reusing the same intent', () => {
  const { queue, seek, queueTimers } = fixture();
  const intent = { mediaKey: 'video-a', target: 30 };
  queue.request(intent);
  const oldTimeout = [...queueTimers.values()][0];
  queue.reset('video-a');
  queue.request(intent);
  queue.request({ mediaKey: 'video-a', target: 60 });
  oldTimeout();
  queue.complete({ mediaKey: 'video-a' });
  expect(seek).toHaveBeenLastCalledWith(expect.objectContaining({ target: 60 }));
});
