import { describe, it, expect } from 'vitest';
import { buildAutoStartCourse } from './autoStartCourse.js';

describe('buildAutoStartCourse', () => {
  it('builds a time-race course (Flash)', () => {
    expect(buildAutoStartCourse({ winCondition: 'time', value: 60 }))
      .toEqual({ win_condition: 'time', goal_m: null, time_cap_s: 60 });
  });

  it('builds a distance-race course (100 m)', () => {
    expect(buildAutoStartCourse({ winCondition: 'distance', value: 100 }))
      .toEqual({ win_condition: 'distance', goal_m: 100, time_cap_s: null });
  });

  it('defaults to distance when winCondition is unknown', () => {
    expect(buildAutoStartCourse({ winCondition: 'wat', value: 250 }))
      .toEqual({ win_condition: 'distance', goal_m: 250, time_cap_s: null });
  });
});
