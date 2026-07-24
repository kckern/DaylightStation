import { createChartDataSource } from './sessionDataAdapter.js';

/**
 * Regression cover for two identity defects on the session-detail page:
 *   - the legend showed a title-cased slug ("Testuser") instead of the real
 *     name, because sessions persist `display_name` as the bare slug.
 *   - a `guest_*` participant requested /static/img/users/guest_<id>, which
 *     the backend answers with a JSON 404 — a broken image in an <img>.
 *
 * Identities here are synthetic, per the no-PII-in-fixtures policy.
 */

const CONFIGURED_USERS = [
  { id: 'testuser', name: 'Test User', groupLabel: 'Dad' },
  { id: 'rider-a', name: 'Rider A' },
];

const emptyTimeline = { series: {}, interval_seconds: 5, tick_count: 0 };

describe('sessionDataAdapter — display names', () => {
  it('resolves a real name from configured users when the session stored the slug', () => {
    const session = {
      // the shape sessions actually persist: display_name === the slug
      participants: { testuser: { display_name: 'testuser' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: CONFIGURED_USERS });
    expect(roster[0].name).toBe('Test User');
    expect(roster[0].displayLabel).toBe('Test User');
  });

  it('prefers the configured name over a stored slug echo regardless of case', () => {
    const session = {
      participants: { 'rider-a': { display_name: 'Rider-a' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: CONFIGURED_USERS });
    expect(roster[0].name).toBe('Rider A');
  });

  it('keeps a real stored display_name when the user is not in the configured list', () => {
    const session = {
      participants: { visitor: { display_name: 'Visiting Relative' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: CONFIGURED_USERS });
    expect(roster[0].name).toBe('Visiting Relative');
  });

  it('falls back to the title-cased slug when nothing else resolves', () => {
    const session = {
      participants: { 'rider-b': { display_name: 'rider-b' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: [] });
    expect(roster[0].name).toBe('Rider-b');
  });
});

describe('sessionDataAdapter — guest avatars', () => {
  it('points a guest_* slug at the shared placeholder, not a per-person asset', () => {
    const session = {
      // guests are persisted with only the slug — no is_guest flag alongside it
      participants: { guest_90001: { display_name: 'guest_90001' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: CONFIGURED_USERS });
    const guest = roster[0];
    expect(guest.isGuest).toBe(true);
    expect(guest.avatarUrl).toContain('guest-adult');
    expect(guest.avatarUrl).not.toContain('guest_90001');
    expect(guest.name).toBe('Guest');
  });

  it('uses the kid placeholder when the guest profile carries that age class', () => {
    const session = {
      participants: {
        guest_90002: { display_name: 'guest_90002', guest_profile: 'kid' },
        guest_90003: { display_name: 'guest_90003', guest_profile: { ageClass: 'kid' } },
      },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: [] });
    for (const row of roster) expect(row.avatarUrl).toContain('guest-kid');
  });

  it('leaves a normal participant\'s avatar keyed to their own slug', () => {
    const session = {
      participants: { testuser: { display_name: 'testuser' } },
      timeline: emptyTimeline,
    };
    const { roster } = createChartDataSource(session, { configuredUsers: CONFIGURED_USERS });
    expect(roster[0].avatarUrl).toContain('testuser');
    expect(roster[0].isGuest).toBe(false);
  });
});
