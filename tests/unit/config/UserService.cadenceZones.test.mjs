import { FitnessUserHydrator } from '#apps/fitness/services/FitnessUserHydrator.mjs';

const makeReader = (profile) => ({ getProfile: (u) => (u === 'user_2' ? profile : null) });

describe('FitnessUserHydrator — per-user cadence_zones hydration', () => {
  it('attaches cadence_zones from the profile to the hydrated user', () => {
    const svc = new FitnessUserHydrator({ profileReader: makeReader({
      username: 'user_2',
      display_name: 'User_2',
      apps: { fitness: {
        heart_rate_zones: { active: 120 },
        cadence_zones: { cruising: 50, pushing: 80, sprint: 105 }
      } }
    }) });
    const [user] = svc.hydrateUsers(['user_2']);
    expect(user.cadence_zones).toEqual({ cruising: 50, pushing: 80, sprint: 105 });
    expect(user.zones).toEqual({ active: 120 });
  });

  it('omits cadence_zones when the profile has none', () => {
    const svc = new FitnessUserHydrator({ profileReader: makeReader({
      username: 'user_2',
      apps: { fitness: { heart_rate_zones: { active: 100 } } }
    }) });
    const [user] = svc.hydrateUsers(['user_2']);
    expect(user.cadence_zones).toBeUndefined();
  });
});
