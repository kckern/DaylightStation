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
const warnFn = vi.fn();
const child = vi.fn(() => ({ info, debug: debugFn, warn: warnFn, error: vi.fn() }));
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
    warnFn.mockClear();
    child.mockClear();
    getLoggerMock.mockClear();
    onLaunch = vi.fn();
  });

  const mount = (opts) => renderHook(() => useFitnessLaunch({ onLaunch, ...opts }));

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
    expect(info).toHaveBeenCalledWith('launch-received', { learnerId: 'kid1', episodeId: '12345', schoolActivity: false });
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

  describe('busy guard (a queue/episode already loaded)', () => {
    it('does not call onLaunch and logs a structured warn when busy', () => {
      mount({ busy: true });
      deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345' });

      expect(onLaunch).not.toHaveBeenCalled();
      expect(warnFn).toHaveBeenCalledWith(
        'fitness-launch-ignored-queue-active',
        { learnerId: 'kid1', episodeId: '12345' }
      );
    });

    it('still ignores a malformed message while busy without warning about it', () => {
      mount({ busy: true });
      deliver({ topic: 'fitness', type: 'fitness.other', learnerId: 'kid1', episodeId: '12345' });

      expect(onLaunch).not.toHaveBeenCalled();
      expect(warnFn).not.toHaveBeenCalled();
    });

    it('launches normally when not busy (default)', () => {
      mount();
      deliver({ topic: 'fitness', type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345' });

      expect(onLaunch).toHaveBeenCalledWith('12345', { learnerId: 'kid1' });
      expect(warnFn).not.toHaveBeenCalled();
    });

    it('prompts locally and preserves the active queue when a School launch is declined', () => {
      const confirmSwitch = vi.fn(() => false);
      const onSchoolDecline = vi.fn();
      const schoolActivity = { workSessionId: 'ses_school_1', unitId: 'pe.lesson-1' };
      mount({ busy: true, confirmSwitch, onSchoolDecline });

      deliver({ type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345', schoolActivity });

      expect(confirmSwitch).toHaveBeenCalledOnce();
      expect(onLaunch).not.toHaveBeenCalled();
      expect(onSchoolDecline).toHaveBeenCalledWith(schoolActivity, { learnerId: 'kid1' });
    });

    it('switches only after the kiosk accepts a busy School launch', () => {
      const confirmSwitch = vi.fn(() => true);
      const schoolActivity = { workSessionId: 'ses_school_1', unitId: 'pe.lesson-1' };
      mount({ busy: true, confirmSwitch });

      deliver({ type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345', schoolActivity });

      expect(onLaunch).toHaveBeenCalledWith('12345', { learnerId: 'kid1', schoolActivity });
      expect(warnFn).not.toHaveBeenCalled();
    });

    it('launches an idle School request without prompting but preserves its attempt metadata', () => {
      const confirmSwitch = vi.fn(() => true);
      const schoolActivity = { workSessionId: 'ses_school_1', unitId: 'pe.lesson-1' };
      mount({ confirmSwitch });

      deliver({ type: 'fitness.launch', learnerId: 'kid1', episodeId: '12345', schoolActivity });

      expect(confirmSwitch).not.toHaveBeenCalled();
      expect(onLaunch).toHaveBeenCalledWith('12345', { learnerId: 'kid1', schoolActivity });
    });
  });
});
