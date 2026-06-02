import { UserService } from '#system/config/UserService.mjs';

const makeCfg = (profile) => ({
  getUserProfile: (u) => (u === 'felix' ? profile : null),
  getAllUserProfiles: () => new Map()
});

describe('UserService — per-user cadence_zones hydration', () => {
  it('attaches cadence_zones from the profile to the hydrated user', () => {
    const svc = new UserService(makeCfg({
      username: 'felix',
      display_name: 'Felix',
      apps: { fitness: {
        heart_rate_zones: { active: 120 },
        cadence_zones: { cruising: 50, pushing: 80, sprint: 105 }
      } }
    }));
    const [user] = svc.hydrateUsers(['felix']);
    expect(user.cadence_zones).toEqual({ cruising: 50, pushing: 80, sprint: 105 });
    expect(user.zones).toEqual({ active: 120 });
  });

  it('omits cadence_zones when the profile has none', () => {
    const svc = new UserService(makeCfg({
      username: 'felix',
      apps: { fitness: { heart_rate_zones: { active: 100 } } }
    }));
    const [user] = svc.hydrateUsers(['felix']);
    expect(user.cadence_zones).toBeUndefined();
  });
});
