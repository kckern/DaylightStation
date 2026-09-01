import { describe, expect, it } from 'vitest';
import { gateConfigForLearner, gateAppliesTo } from './gateScope.js';

// A rollout has to be able to start small: one child, one game, watched. The
// household block is the default for everybody and `users.{id}` overrides it
// key-by-key, so a scoped block must not disturb the child it does not name.
describe('gateConfigForLearner / gateAppliesTo — default plus per-user override', () => {
  const household = {
    enabled: false,
    passScore: 0.8,
    users: { kckern: { enabled: true, games: ['chess'], passScore: 0.6 } },
  };

  it('a child with no entry gets the household default, and the users map never leaks through', () => {
    const forKid = gateConfigForLearner(household, 'user_2');
    expect(forKid).toEqual({ enabled: false, passScore: 0.8 });
    expect(forKid.users).toBeUndefined();
    expect(gateAppliesTo(household, { learnerId: 'user_2', gameId: 'chess' })).toBe(false);
  });

  it('a named child gets their override merged over the default', () => {
    const forKc = gateConfigForLearner(household, 'kckern');
    expect(forKc.enabled).toBe(true);
    expect(forKc.passScore).toBe(0.6); // override wins
    expect(forKc.users).toBeUndefined();
  });

  it('the games allowlist narrows an enabled gate to the named ids', () => {
    expect(gateAppliesTo(household, { learnerId: 'kckern', gameId: 'chess' })).toBe(true);
    expect(gateAppliesTo(household, { learnerId: 'kckern', gameId: 'tetris' })).toBe(false);
  });

  it('an absent or malformed games key means every game, so an unscoped block behaves as before', () => {
    for (const games of [undefined, null, 'chess', 42, {}]) {
      const raw = { enabled: true, ...(games === undefined ? {} : { games }) };
      expect(gateAppliesTo(raw, { learnerId: 'kckern', gameId: 'tetris' }), String(games)).toBe(true);
    }
  });

  it('a prototype key in the users map is not an override', () => {
    // `learnerId` arrives from the roster; `users.constructor` must not resolve
    // to a function and be spread over the household settings.
    const raw = { enabled: false, users: {} };
    expect(gateConfigForLearner(raw, 'constructor')).toEqual({ enabled: false });
    expect(gateAppliesTo(raw, { learnerId: 'constructor', gameId: 'chess' })).toBe(false);
  });

  it('null, a missing block, and a non-object all resolve to "no gate"', () => {
    for (const raw of [null, undefined, 'yes', 7, []]) {
      expect(gateAppliesTo(raw, { learnerId: 'kckern', gameId: 'chess' }), String(raw)).toBe(false);
    }
  });
});
