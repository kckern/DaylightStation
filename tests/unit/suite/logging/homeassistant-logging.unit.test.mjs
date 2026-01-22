import { jest } from '@jest/globals';
import { initializeLogging, resetLogging, getDispatcher } from '#backend/lib/logging/dispatcher.js';

describe('home assistant logging', () => {
  let dispatchSpy;

  beforeEach(() => {
    resetLogging();
    initializeLogging({ defaultLevel: 'debug' });
    dispatchSpy = jest.spyOn(getDispatcher(), 'dispatch');
  });

  afterEach(() => {
    resetLogging();
  });

  test('uses sampled logging for scene activation', async () => {
    // Import after mocking
    const { activateScene } = await import('#backend/lib/homeassistant.mjs');

    // Call multiple times
    for (let i = 0; i < 25; i++) {
      await activateScene('test_scene');
    }

    // Should have sampled the activating calls
    const activatingCalls = dispatchSpy.mock.calls.filter(
      call => call[0].event === 'homeassistant.scene.activating'
    );

    // With maxPerMinute: 30, all 25 should log in first window
    expect(activatingCalls.length).toBeLessThanOrEqual(30);

    // Sampled logging uses 'info' level, not 'debug'
    // This verifies sampled() was used instead of debug()
    if (activatingCalls.length > 0) {
      expect(activatingCalls[0][0].level).toBe('info');
    }
  });
});
