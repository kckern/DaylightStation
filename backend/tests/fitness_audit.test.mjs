
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { FitnessSession } from '../../frontend/src/hooks/fitness/FitnessSession.js';
import { VoiceMemoManager } from '../../frontend/src/hooks/fitness/VoiceMemoManager.js';

// Mock dependencies
global.Date = class extends Date {
  constructor(...args) {
    super(...args);
  }
};

const mockPersistApi = jest.fn().mockResolvedValue({ ok: true });

describe('FitnessSession Audit', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession();
    session._persistApi = mockPersistApi;
    mockPersistApi.mockClear();
  });

  test('should not save empty session with 1ms duration', () => {
    session.ensureStarted();
    // Immediately end
    session.endSession('manual');

    // Should NOT be called because validation fails
    expect(mockPersistApi).not.toHaveBeenCalled();
    
    // If we want to verify the log, we'd need to mock console or _log, but checking persistApi is enough.
  });

  test('should save voice memos', () => {
    session.ensureStarted();
    session.voiceMemoManager.addMemo({
      transcriptClean: 'Test memo',
      durationSeconds: 5
    });
    
    session.endSession('manual');
    
    const payload = mockPersistApi.mock.calls[0][1].sessionData;
    expect(payload.voiceMemos).toHaveLength(1);
    expect(payload.voiceMemos[0].transcriptClean).toBe('Test memo');
  });

  test('should encode series correctly', () => {
    session.ensureStarted();
    
    // Initialize timeline properly via internal method if needed, or just let it be created
    // We can't easily inject a mock timeline because it's created internally.
    // So we rely on recordDeviceActivity to trigger creation and data population.
    
    // We need to mock FitnessTimeline if we want to control it, but for this test 
    // we just want to see if series are encoded.
    // Let's try to use the real FitnessTimeline by simulating data.
    
    const now = Date.now();
    // Manually set start time to be older to avoid spam detection
    session.startTime = now - 15000;
    
    session.recordDeviceActivity({
      deviceId: 'test_device',
      type: 'heart_rate',
      heartRate: 60,
      timestamp: now
    });
    
    // Force a tick to capture the data
    session._collectTimelineTick({ timestamp: now });
    
    session.endSession('manual');
    
    const payload = mockPersistApi.mock.calls[0][1].sessionData;
    // console.log('Series payload:', JSON.stringify(payload.timeline, null, 2));
    
    // Check if series exists and is encoded
    // Note: The key might be 'device:test_device:heart_rate' or similar
    const seriesKeys = Object.keys(payload.timeline.series);
    expect(seriesKeys.length).toBeGreaterThan(0);
    
    const key = seriesKeys[0];
    expect(typeof payload.timeline.series[key]).toBe('string'); // Should be stringified RLE
    expect(payload.timeline.seriesMeta[key]).toBeDefined();
    expect(payload.timeline.seriesMeta[key].encoding).toBe('rle');
  });
});
