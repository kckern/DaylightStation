// fitnessAudience.test.js
import { describe, it, expect } from 'vitest';
import { rosterAudience } from './fitnessAudience.js';

describe('rosterAudience', () => {
  it('declares the active riders, guests flagged and unnamed', () => {
    const a = rosterAudience([
      { id: 'rider-a', name: 'Rider A', isActive: true, heartRate: 120 },
      { profileId: 'guest-1', name: 'Visitor', isGuest: true, isActive: true },
      { id: 'rider-b', name: 'Rider B', isActive: false },
    ]);
    expect(a).toEqual({ activity: 'workout', people: [
      { id: 'rider-a', name: 'Rider A', role: 'rider', guest: false },
      { id: 'guest-1', name: null, role: 'rider', guest: true },
    ] });
  });
  it('is null with no session roster', () => {
    expect(rosterAudience([])).toBeNull();
    expect(rosterAudience(null)).toBeNull();
    expect(rosterAudience([{ name: 'no id', isActive: true }])).toBeNull();
  });
});
