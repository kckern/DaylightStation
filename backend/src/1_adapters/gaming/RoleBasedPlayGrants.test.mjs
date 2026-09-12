import { describe, it, expect } from 'vitest';
import { RoleBasedPlayGrants } from './RoleBasedPlayGrants.mjs';

const quiet = { warn() {} };
const build = (profiles) => new RoleBasedPlayGrants({
  profileFor: async (id) => profiles[id] ?? null, logger: quiet,
});

const PROFILES = {
  parent: { username: 'parent', type: 'owner', roles: ['sysadmin'] },
  'co-parent': { username: 'co-parent', type: 'family_member', roles: ['parent'] },
  child: { username: 'child', type: 'family_member' },
};

describe('RoleBasedPlayGrants', () => {
  it('grants an adult play with no ceiling', async () => {
    const g = await build(PROFILES).forSession({ userId: 'parent' });
    expect(g).toEqual({ grantedMs: null, grantRef: 'admin:parent' });
  });

  it('recognises an adult by role as well as by ownership', async () => {
    const g = await build(PROFILES).forSession({ userId: 'co-parent' });
    expect(g.grantedMs).toBeNull();
  });

  it('gives a child NO grant, which is not the same as unlimited', async () => {
    // No grant means nothing counts down and nothing is ever stopped — the
    // child's play is measured and recorded but not yet costed.
    expect(await build(PROFILES).forSession({ userId: 'child' })).toBeNull();
  });

  it('gives an unattributed session no grant', async () => {
    expect(await build(PROFILES).forSession({ userId: null })).toBeNull();
  });

  it('gives an unknown user no grant', async () => {
    expect(await build(PROFILES).forSession({ userId: 'stranger' })).toBeNull();
  });

  it('never falls back to unlimited when the profile cannot be read', async () => {
    const g = new RoleBasedPlayGrants({
      profileFor: async () => { throw new Error('store down'); }, logger: quiet,
    });
    expect(await g.forSession({ userId: 'parent' })).toBeNull();
  });

  it('requires a profile lookup rather than guessing', () => {
    expect(() => new RoleBasedPlayGrants({})).toThrow(/profileFor/);
  });
});
