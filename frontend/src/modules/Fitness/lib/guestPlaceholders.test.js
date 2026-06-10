import { genericGuestImageId, isGenericGuestProfileId } from './guestPlaceholders.js';

describe('guest placeholders (audit N5)', () => {
  it('maps age class to placeholder image ids', () => {
    expect(genericGuestImageId('kid')).toBe('guest-kid');
    expect(genericGuestImageId('adult')).toBe('guest-adult');
    expect(genericGuestImageId(null)).toBe('guest-adult');
  });
  it('detects device-keyed generic guest profileIds', () => {
    expect(isGenericGuestProfileId('guest_48291')).toBe(true);
    expect(isGenericGuestProfileId('friend-b')).toBe(false);
    expect(isGenericGuestProfileId(null)).toBe(false);
  });
});
