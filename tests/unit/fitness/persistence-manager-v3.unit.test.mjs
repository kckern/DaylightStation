import { describe, it, expect } from '@jest/globals';
import { PersistenceManager } from '../../../frontend/src/hooks/fitness/PersistenceManager.js';

describe('PersistenceManager v3 integration', () => {
  it('uses SessionSerializerV3 to build payload', () => {
    const pm = new PersistenceManager();

    const sessionData = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      treasureBox: { totalCoins: 100, buckets: {} },
      timeline: { timebase: { intervalMs: 5000, tickCount: 10 }, series: {} }
    };

    const payload = pm.buildPayload(sessionData);

    expect(payload.version).toBe(3);
    expect(payload.session).toBeDefined();
    expect(payload.session.id).toBe('20260106114853');
  });

  it('returns v3 payload with participants when provided', () => {
    const pm = new PersistenceManager();

    const sessionData = {
      sessionId: '20260106120000',
      startTime: 1767730800000,
      endTime: 1767734400000,
      timezone: 'America/Los_Angeles',
      treasureBox: { totalCoins: 250, buckets: { hot: 50, warm: 100, active: 100 } },
      participants: {
        'user-abc': {
          display_name: 'Test User',
          is_primary: true,
          is_guest: false,
          hr_device: 'device-123'
        }
      },
      timeline: {
        timebase: { intervalMs: 5000, tickCount: 720 },
        series: {
          'user:user-abc:heart_rate': [75, 80, 85, 90, 95, 100],
          'user:user-abc:zone_id': ['c', 'c', 'a', 'a', 'w', 'w']
        }
      }
    };

    const payload = pm.buildPayload(sessionData);

    expect(payload.version).toBe(3);
    expect(payload.session.id).toBe('20260106120000');
    expect(payload.session.date).toBe('2026-01-06');
    expect(payload.session.duration_seconds).toBe(3600);
    expect(payload.totals).toBeDefined();
    expect(payload.totals.coins).toBe(250);
    expect(payload.participants).toBeDefined();
    expect(payload.participants['user-abc']).toBeDefined();
    expect(payload.participants['user-abc'].display_name).toBe('Test User');
  });

  it('includes timeline with nested participant series', () => {
    const pm = new PersistenceManager();

    const sessionData = {
      sessionId: '20260106130000',
      startTime: 1767734400000,
      endTime: 1767738000000,
      timezone: 'America/Los_Angeles',
      participants: {
        'user-xyz': {
          display_name: 'Another User',
          is_primary: true
        }
      },
      timeline: {
        timebase: { intervalMs: 5000, tickCount: 6 },
        series: {
          'user:user-xyz:heart_rate': [100, 105, 110, 115, 120, 125]
        }
      }
    };

    const payload = pm.buildPayload(sessionData);

    expect(payload.timeline).toBeDefined();
    expect(payload.timeline.interval_seconds).toBe(5);
    expect(payload.timeline.tick_count).toBe(6);
    expect(payload.timeline.encoding).toBe('rle');
    expect(payload.timeline.participants).toBeDefined();
    expect(payload.timeline.participants['user-xyz']).toBeDefined();
    expect(payload.timeline.participants['user-xyz'].hr).toBeDefined();
  });
});
