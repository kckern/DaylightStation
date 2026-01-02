import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityMonitor } from '../ActivityMonitor.js';

describe('ActivityMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new ActivityMonitor();
  });

  describe('reconstructFromTimeline', () => {
    it('should reconstruct dropout events from gaps in heart rate series', () => {
      const participantId = 'user1';
      const timebase = { startTime: 1000 };
      
      // Mock series data
      // Tick: 0  1  2  3  4  5  6  7
      // HR:   80 82 85 -- -- 80 82 85  (Dropout at tick 2 -> 3)
      // Coins:10 12 15 15 15 15 17 20
      
      const hrSeries = [80, 82, 85, null, null, 80, 82, 85];
      const coinSeries = [10, 12, 15, 15, 15, 15, 17, 20];
      
      const getSeries = (id, metric) => {
        if (id !== participantId) return [];
        if (metric === 'heart_rate') return hrSeries;
        if (metric === 'coins_total') return coinSeries;
        return [];
      };

      monitor.reconstructFromTimeline(getSeries, [participantId], timebase);

      const events = monitor.getDropoutEvents(participantId);
      
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        tick: 2, // Last active tick
        value: 15, // Value at last active tick
        timestamp: 1000 + (2 * 1000), // 3000
        id: `${participantId}-dropout-2`
      });
    });

    it('should handle multiple dropouts', () => {
      const participantId = 'user1';
      const timebase = { startTime: 1000 };
      
      // Tick: 0  1  2  3  4  5  6  7  8  9
      // HR:   80 -- -- 80 82 -- -- -- 85 86
      // Coins:10 10 10 12 14 14 14 14 16 18
      
      const hrSeries = [80, null, null, 80, 82, null, null, null, 85, 86];
      const coinSeries = [10, 10, 10, 12, 14, 14, 14, 14, 16, 18];
      
      const getSeries = (id, metric) => {
        if (id !== participantId) return [];
        if (metric === 'heart_rate') return hrSeries;
        if (metric === 'coins_total') return coinSeries;
        return [];
      };

      monitor.reconstructFromTimeline(getSeries, [participantId], timebase);

      const events = monitor.getDropoutEvents(participantId);
      
      assert.equal(events.length, 2);
      
      // First dropout at tick 0
      assert.equal(events[0].tick, 0);
      assert.equal(events[0].value, 10);
      
      // Second dropout at tick 4
      assert.equal(events[1].tick, 4);
      assert.equal(events[1].value, 14);
    });

    it('should ignore initial nulls (not a dropout)', () => {
      const participantId = 'user1';
      const timebase = { startTime: 1000 };
      
      // Tick: 0  1  2  3
      // HR:   -- -- 80 82
      
      const hrSeries = [null, null, 80, 82];
      const coinSeries = [0, 0, 10, 12];
      
      const getSeries = (id, metric) => {
        if (id !== participantId) return [];
        if (metric === 'heart_rate') return hrSeries;
        if (metric === 'coins_total') return coinSeries;
        return [];
      };

      monitor.reconstructFromTimeline(getSeries, [participantId], timebase);

      const events = monitor.getDropoutEvents(participantId);
      assert.equal(events.length, 0);
    });

    it('should survive remount (reconstruction from persisted series)', () => {
      const participantId = 'user1';
      const timebase = { startTime: 1000 };
      
      // 1. Simulate live session with a dropout
      monitor.recordDropout(participantId, 5, 100, 2000);
      
      const liveEvents = monitor.getDropoutEvents(participantId);
      assert.equal(liveEvents.length, 1);
      
      // 2. Simulate component unmount / page reload (new monitor instance)
      const newMonitor = new ActivityMonitor();
      
      // 3. Simulate persisted data available from server
      // Tick 5 was the last active tick, so tick 6 is null
      const hrSeries = [80, 80, 80, 80, 80, 80, null, null, 80]; 
      const coinSeries = [20, 40, 60, 80, 100, 100, 100, 100, 120];
      
      const getSeries = (id, metric) => {
        if (id !== participantId) return [];
        if (metric === 'heart_rate') return hrSeries;
        if (metric === 'coins_total') return coinSeries;
        return [];
      };
      
      // 4. Reconstruct
      newMonitor.reconstructFromTimeline(getSeries, [participantId], timebase);
      
      // 5. Verify dropout is restored
      const restoredEvents = newMonitor.getDropoutEvents(participantId);
      assert.equal(restoredEvents.length, 1);
      assert.equal(restoredEvents[0].tick, 5);
      assert.equal(restoredEvents[0].value, 100);
    });
  });
});