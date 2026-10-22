import { describe, it, expect } from 'vitest';
import { FLING_CHOICE_FRACTION, flingStartChoice, flingStartAt } from "./flingStart.js";

describe('flingStartChoice', () => {
  it('offers no choice before 10% of the duration: the screen starts at 0', () => {
    expect(FLING_CHOICE_FRACTION).toBe(0.1);
    expect(flingStartChoice({ position: 59, duration: 600 })).toEqual({ offerChoice: false, position: 59 });
  });

  it('offers the choice at or past 10% of the duration', () => {
    expect(flingStartChoice({ position: 60, duration: 600 })).toEqual({ offerChoice: true, position: 60 });
    expect(flingStartChoice({ position: 3725.6, duration: 7200 })).toEqual({ offerChoice: true, position: 3725.6 });
  });

  it('offers no choice without a known duration or for live playback', () => {
    expect(flingStartChoice({ position: 300, duration: 0 }).offerChoice).toBe(false);
    expect(flingStartChoice({ position: 300, duration: null }).offerChoice).toBe(false);
    expect(flingStartChoice({ position: 300, duration: 600, isLive: true }).offerChoice).toBe(false);
    expect(flingStartChoice({ position: Number.NaN, duration: 600 })).toEqual({ offerChoice: false, position: 0 });
  });
});

describe('flingStartAt', () => {
  it('starts at 0 from the beginning, at the position where I am', () => {
    expect(flingStartAt('beginning', 412.7)).toBe(0);
    expect(flingStartAt('current', 412.7)).toBe(412.7);
    expect(flingStartAt('current', -3)).toBe(0);
  });
});
