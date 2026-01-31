import { jest } from '@jest/globals';

// Mock logger
const mockDebug = jest.fn();
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: mockDebug, sampled: mockSampled, info: mockInfo, warn: mockWarn }),
  getLogger: () => ({ debug: mockDebug, sampled: mockSampled, info: mockInfo, warn: mockWarn })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine reactive evaluation', () => {
  let engine;
  let mockSession;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDebug.mockClear();
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();

    mockSession = {
      roster: [],
      treasureBox: { setGovernanceCallback: jest.fn() },
      logEvent: jest.fn()
    };
    engine = new GovernanceEngine(mockSession);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('notifyZoneChange schedules debounced evaluation', () => {
    engine.configure({
      governed_labels: ['kckern'],
      policies: {
        warmup: { zones: ['active', 'warm', 'hot', 'fire'], rule: 'all_above' }
      }
    });

    // Spy AFTER configure (which also calls evaluate)
    const evaluateSpy = jest.spyOn(engine, 'evaluate');

    engine.notifyZoneChange('kckern', { fromZone: 'cool', toZone: 'active' });

    // Should not have evaluated yet (debounce)
    expect(evaluateSpy).not.toHaveBeenCalled();

    // Fast forward past debounce period
    jest.advanceTimersByTime(150);

    expect(evaluateSpy).toHaveBeenCalled();
  });

  test('debounces rapid zone changes within 100ms', () => {
    engine.configure({
      governed_labels: ['kckern', 'felix'],
      policies: {}
    });

    // Spy AFTER configure (which also calls evaluate)
    const evaluateSpy = jest.spyOn(engine, 'evaluate');

    // Rapid zone changes
    engine.notifyZoneChange('kckern', { fromZone: 'cool', toZone: 'active' });
    jest.advanceTimersByTime(30);
    engine.notifyZoneChange('felix', { fromZone: 'warm', toZone: 'hot' });
    jest.advanceTimersByTime(30);
    engine.notifyZoneChange('kckern', { fromZone: 'active', toZone: 'warm' });

    // Still within debounce, no evaluate yet
    expect(evaluateSpy).not.toHaveBeenCalled();

    // Fast forward past debounce
    jest.advanceTimersByTime(150);

    // Should only have evaluated once despite 3 notifications
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });

  test('logs zone change notification with debug', () => {
    engine.configure({
      governed_labels: ['user1'],
      policies: {}
    });

    engine.notifyZoneChange('user1', { fromZone: 'cool', toZone: 'active' });

    expect(mockDebug).toHaveBeenCalledWith(
      'governance.zone_change_notification',
      expect.objectContaining({
        userId: 'user1',
        fromZone: 'cool',
        toZone: 'active'
      })
    );
  });

  test('reset clears zone change debounce timer', () => {
    engine.configure({
      governed_labels: ['user1'],
      policies: {}
    });

    engine.notifyZoneChange('user1', { fromZone: 'cool', toZone: 'active' });

    // Reset before debounce completes
    engine.reset();

    const evaluateSpy = jest.spyOn(engine, 'evaluate');

    // Advance past debounce period
    jest.advanceTimersByTime(150);

    // The scheduled evaluate should have been canceled
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  test('_logZoneChanges triggers notifyZoneChange on zone transition', () => {
    const notifySpy = jest.spyOn(engine, 'notifyZoneChange');

    // Set up previous zone map
    engine._previousUserZoneMap = { user1: 'cool' };

    // Call _logZoneChanges with new zone
    engine._logZoneChanges(
      { user1: 'warm' },
      { cool: { name: 'Cool' }, warm: { name: 'Warm' } }
    );

    expect(notifySpy).toHaveBeenCalledWith('user1', { fromZone: 'cool', toZone: 'warm' });
  });

  test('_logZoneChanges does not trigger for same zone', () => {
    const notifySpy = jest.spyOn(engine, 'notifyZoneChange');

    // Set up previous zone map
    engine._previousUserZoneMap = { user1: 'warm' };

    // Call _logZoneChanges with same zone
    engine._logZoneChanges(
      { user1: 'warm' },
      { warm: { name: 'Warm' } }
    );

    expect(notifySpy).not.toHaveBeenCalled();
  });

  test('_logZoneChanges does not trigger for new users (no previous zone)', () => {
    const notifySpy = jest.spyOn(engine, 'notifyZoneChange');

    // Empty previous zone map (new user)
    engine._previousUserZoneMap = {};

    // Call _logZoneChanges with new user
    engine._logZoneChanges(
      { newUser: 'warm' },
      { warm: { name: 'Warm' } }
    );

    // Should not notify for new users (prevZone is undefined)
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
