import { describe, it, expect } from 'vitest';
import { buildRaceConfigFromCourse, formatClock } from './cycleGameLobby.js';

describe('buildRaceConfigFromCourse', () => {
  const riders = [{ userId: 'milo', wheelCircumferenceM: 2.1 }];
  it('maps a distance course', () => {
    const cfg = buildRaceConfigFromCourse(
      { id: 'alps_3k', win_condition: 'distance', goal_m: 3000, background_plex_id: 'plex:1' },
      { riders, startCountdownS: 3 }
    );
    expect(cfg.winCondition).toBe('distance');
    expect(cfg.goalM).toBe(3000);
    expect(cfg.timeCapS).toBeUndefined();
    expect(cfg.courseId).toBe('alps_3k');
    expect(cfg.backgroundPlexId).toBe('plex:1');
    expect(cfg.riders).toBe(riders);
    expect(cfg.startCountdownS).toBe(3);
  });
  it('maps a time course', () => {
    const cfg = buildRaceConfigFromCourse({ id: 'c', win_condition: 'time', time_cap_s: 300 }, {});
    expect(cfg.winCondition).toBe('time');
    expect(cfg.timeCapS).toBe(300);
    expect(cfg.goalM).toBeUndefined();
  });
  it('falls back to opts/defaults for a custom (course-less) race', () => {
    const cfg = buildRaceConfigFromCourse({}, { winCondition: 'distance', goalM: 1500 });
    expect(cfg.goalM).toBe(1500);
    expect(cfg.courseId).toBeNull();
    expect(cfg.intervalMs).toBe(1000);
  });
  it('passes through the distance-race mercy-kill window (issue 2)', () => {
    const cfg = buildRaceConfigFromCourse({}, { raceMercyAfterWinnerS: 45 });
    expect(cfg.raceMercyAfterWinnerS).toBe(45);
  });
  it('defaults the mercy-kill window to 0 (off) when not provided', () => {
    const cfg = buildRaceConfigFromCourse({}, {});
    expect(cfg.raceMercyAfterWinnerS).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(252)).toBe('4:12');
  });
  it('clamps negatives to 0:00', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
