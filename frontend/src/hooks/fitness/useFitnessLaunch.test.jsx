import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies, hoisted so the vi.mock factories can close over them (pattern:
// useSchoolLaunch.test.jsx / useKioskLaunchCommand.test.js) — capture the
// subscriber callback so tests can push WS messages at it directly.
const h = vi.hoisted(() => ({ handlers: [] }));

vi.mock('../useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));

const info = vi.fn();
const debugFn = vi.fn();
const child = vi.fn(() => ({ info, debug: debugFn, warn: vi.fn(), error: vi.fn() }));
const getLoggerMock = vi.fn(() => ({ child }));
vi.mock('../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

import { useFitnessLaunch } from './useFitnessLaunch.js';

const deliver = (msg) => h.handlers[0](msg);

describe('useFitnessLaunch', () => {
  let onLaunch;

  beforeEach(() => {
    h.handlers.length = 0;
    info.mockClear();
    debugFn.mockClear();
    child.mockClear();
    getLoggerMock.mockClear();
    onLaunch = vi.fn();
  });

  const mount = () => renderHook(() => useFitnessLaunch({ onLaunch }));

  it('calls onLaunch with the episodeId and learnerId on a well-formed message', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345' });

    expect(onLaunch).toHaveBeenCalledWith('12345', { learnerId: 'kid1' });
  });

  it('defaults learnerId to null when absent', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', episodeId: '12345' });

    expect(onLaunch).toHaveBeenCalledWith('12345', { learnerId: null });
  });

  it('logs launch-received with the learnerId and episodeId', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345' });
    expect(info).toHaveBeenCalledWith('launch-received', { learnerId: 'kid1', episodeId: '12345' });
  });

  it('ignores a message missing type', () => {
    mount();
    deliver({ topic: 'fitness', learnerId: 'kid1', episodeId: '12345' });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message with the wrong type', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.other', learnerId: 'kid1', episodeId: '12345' });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message missing episodeId', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1' });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message with an empty-string episodeId', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: '' });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message with a non-string episodeId', () => {
    mount();
    deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: 12345 });
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores an unrelated broadcast entirely (other topic/shape)', () => {
    mount();
    deliver({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target: {} });
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
