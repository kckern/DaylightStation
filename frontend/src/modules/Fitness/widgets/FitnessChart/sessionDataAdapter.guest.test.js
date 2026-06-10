import { createChartDataSource } from './sessionDataAdapter.js';

describe('sessionDataAdapter — guest flags (audit N10)', () => {
  it('exposes isGuest and guestProfile from the participants block', () => {
    const session = {
      participants: {
        'user-a': { display_name: 'User A', is_primary: true },
        'guest_48291': { display_name: 'Guest', is_guest: true, guest_profile: 'kid' }
      },
      timeline: { series: {}, interval_seconds: 5, tick_count: 0 }
    };
    const { roster } = createChartDataSource(session);
    const guest = roster.find(r => r.id === 'guest_48291');
    expect(guest).toMatchObject({ isGuest: true, guestProfile: 'kid' });
    const primary = roster.find(r => r.id === 'user-a');
    expect(primary.isGuest).toBe(false);
  });
});
