import { describe, expect, it } from 'vitest';
import { gamesDisabledFor } from './gameAccessPolicy.js';

describe('gameAccessPolicy — who is not offered games at all', () => {
  it('names the player it was given', () => {
    expect(gamesDisabledFor({ disabledFor: ['kid1'] }, 'kid1')).toBe(true);
    expect(gamesDisabledFor({ disabledFor: ['kid1'] }, 'kid2')).toBe(false);
  });

  it('a household that never heard of this key is unchanged', () => {
    // The single most important case: absent config must not disable anybody.
    for (const config of [null, undefined, {}, { disabledFor: null }, { disabledFor: [] }]) {
      expect(gamesDisabledFor(config, 'kid1')).toBe(false);
    }
  });

  it('matches an id whatever case or padding it was typed with', () => {
    expect(gamesDisabledFor({ disabledFor: ['  Kid1 '] }, 'kid1')).toBe(true);
    expect(gamesDisabledFor({ disabledFor: ['kid1'] }, ' KID1')).toBe(true);
  });

  it('never disables a player with no id — that is the guest, not a match', () => {
    // A blank id matching a blank list entry would take games off the whole
    // kiosk for anyone who had not picked a profile yet.
    for (const id of [null, undefined, '', '   ']) {
      expect(gamesDisabledFor({ disabledFor: ['', '   ', 'kid1'] }, id)).toBe(false);
    }
  });

  it('drops junk entries rather than guessing what they meant', () => {
    expect(gamesDisabledFor({ disabledFor: [42, null, {}, 'kid1'] }, 'kid1')).toBe(true);
    expect(gamesDisabledFor({ disabledFor: 'kid1' }, 'kid1')).toBe(false); // a string is not a list
  });
});
