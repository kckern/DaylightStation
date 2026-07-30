import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies, hoisted so the vi.mock factories can close over them (pattern:
// useKioskLaunchCommand.test.js) — capture the subscriber callback so tests
// can push WS messages at it directly.
const h = vi.hoisted(() => ({ handlers: [] }));

vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));

const info = vi.fn();
const debugFn = vi.fn();
const child = vi.fn(() => ({ info, debug: debugFn, warn: vi.fn(), error: vi.fn() }));
const getLoggerMock = vi.fn(() => ({ child }));
vi.mock('../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

import { useSchoolLaunch } from './useSchoolLaunch.js';

const deliver = (msg) => h.handlers[0](msg);

describe('useSchoolLaunch', () => {
  let claim;
  let onLaunch;

  beforeEach(() => {
    h.handlers.length = 0;
    info.mockClear();
    debugFn.mockClear();
    child.mockClear();
    getLoggerMock.mockClear();
    claim = vi.fn();
    onLaunch = vi.fn();
  });

  const mount = () => renderHook(() => useSchoolLaunch({ claim, onLaunch }));

  it('claims the learner then launches a program target, in that order', () => {
    mount();
    const target = { kind: 'program', program: 'language' };
    deliver({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target });

    expect(claim).toHaveBeenCalledWith('kid1');
    expect(onLaunch).toHaveBeenCalledWith(target);
    const claimOrder = claim.mock.invocationCallOrder[0];
    const launchOrder = onLaunch.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(launchOrder);
  });

  it('claims the learner then launches a bank target, in that order', () => {
    mount();
    const target = { kind: 'bank', bankId: 'caps', unitId: 'u1', sessionId: 'ses_1' };
    deliver({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target });

    expect(claim).toHaveBeenCalledWith('kid1');
    expect(onLaunch).toHaveBeenCalledWith(target);
    const claimOrder = claim.mock.invocationCallOrder[0];
    const launchOrder = onLaunch.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(launchOrder);
  });

  it('logs launch-received with the target kind and learnerId', () => {
    mount();
    deliver({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target: { kind: 'bank', bankId: 'caps' } });
    expect(info).toHaveBeenCalledWith('launch-received', { kind: 'bank', learnerId: 'kid1' });
  });

  it('ignores a message missing type', () => {
    mount();
    deliver({ topic: 'school', learnerId: 'kid1', target: { kind: 'bank', bankId: 'caps' } });
    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message with the wrong type', () => {
    mount();
    deliver({ topic: 'school', type: 'school.other', learnerId: 'kid1', target: { kind: 'bank', bankId: 'caps' } });
    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message with a null target', () => {
    mount();
    deliver({ topic: 'school', type: 'school.launch', learnerId: 'kid1', target: null });
    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores a message missing learnerId', () => {
    mount();
    deliver({ topic: 'school', type: 'school.launch', target: { kind: 'bank', bankId: 'caps' } });
    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('ignores an unrelated broadcast entirely (other topic/shape)', () => {
    mount();
    deliver({ topic: 'fitness', sessionActive: true });
    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
