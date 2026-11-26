import { describe, it, expect } from 'vitest';
import { canPlayOn } from './playDestination.js';

// The phone app is a Play-on target for sound: its native player plays audio only.
describe('canPlayOn — the phone', () => {
  const phone = { id: 'phone', type: 'phone', content_control: { provider: 'phone-inbox' } };
  it('takes music, talks and unknown kinds, never video', () => {
    expect(canPlayOn(phone, 'audio')).toBe(true);
    expect(canPlayOn(phone, null)).toBe(true);
    expect(canPlayOn(phone, 'video')).toBe(false);
  });
  it('is a phone by its provider even without a type', () => {
    expect(canPlayOn({ id: 'phone', content_control: { provider: 'phone-inbox' } }, 'video')).toBe(false);
  });
});
