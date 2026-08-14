import { describe, expect, it } from 'vitest';
import {
  checkTakeback, playerMoveCount, takebackLimits, takebackNote,
  takebackRefusalMessage, willStillCount,
} from './takebackBudget.js';

describe('takeback limits from config', () => {
  it('defaults to three a game and no cooldown', () => {
    expect(takebackLimits(null)).toEqual({ max_per_game: 3, cooldown_moves: 0 });
  });

  it('reads the config', () => {
    const config = { help: { takebacks: { max_per_game: 1, cooldown_moves: 4 } } };
    expect(takebackLimits(config)).toEqual({ max_per_game: 1, cooldown_moves: 4 });
  });

  it('treats an explicit null cap as unlimited, which a missing key is not', () => {
    expect(takebackLimits({ help: { takebacks: { max_per_game: null } } }).max_per_game).toBe(null);
    expect(takebackLimits({ help: { takebacks: {} } }).max_per_game).toBe(3);
  });

  it('refuses a nonsense cap rather than passing it on', () => {
    expect(takebackLimits({ help: { takebacks: { max_per_game: 'lots' } } }).max_per_game).toBe(3);
    expect(takebackLimits({ help: { takebacks: { max_per_game: -2 } } }).max_per_game).toBe(0);
  });
});

describe('whether a takeback may be played now', () => {
  const config = { help: { takebacks: { max_per_game: 2, cooldown_moves: 0 } } };

  it('allows one while the budget holds and reports what is left', () => {
    expect(checkTakeback({ config, used: 0 })).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkTakeback({ config, used: 1 })).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('refuses once the budget is spent', () => {
    const check = checkTakeback({ config, used: 2 });
    expect(check).toMatchObject({ allowed: false, reason: 'no_takebacks_left', remaining: 0 });
  });

  it('never runs out when the cap is null', () => {
    const unlimited = { help: { takebacks: { max_per_game: null } } };
    expect(checkTakeback({ config: unlimited, used: 99 })).toMatchObject({ allowed: true, remaining: null });
  });

  it('holds a takeback back until the cooldown has run', () => {
    const cooling = { help: { takebacks: { max_per_game: 3, cooldown_moves: 3 } } };
    expect(checkTakeback({ config: cooling, used: 1, movesSinceLast: 1 }))
      .toMatchObject({ allowed: false, reason: 'cooling_down', movesLeft: 2 });
    expect(checkTakeback({ config: cooling, used: 1, movesSinceLast: 3 })).toMatchObject({ allowed: true });
  });

  it('does not cool down before the first takeback of a game', () => {
    const cooling = { help: { takebacks: { max_per_game: 3, cooldown_moves: 3 } } };
    expect(checkTakeback({ config: cooling, used: 0, movesSinceLast: null })).toMatchObject({ allowed: true });
  });
});

describe('whether the next takeback keeps the game counting', () => {
  it('follows the ladder ceiling', () => {
    expect(willStillCount({ policy: { max_takebacks: 1 }, used: 0 })).toBe(true);
    expect(willStillCount({ policy: { max_takebacks: 1 }, used: 1 })).toBe(false);
    expect(willStillCount({ policy: { max_takebacks: 0 }, used: 0 })).toBe(false);
  });

  it('assumes the default ceiling when no policy has loaded', () => {
    expect(willStillCount({ policy: null, used: 0 })).toBe(true);
  });
});

describe('what the game says about it', () => {
  it('names the number of moves left to wait, in the plural it needs', () => {
    expect(takebackRefusalMessage({ reason: 'cooling_down', movesLeft: 1 }))
      .toBe('You can take another move back in 1 move.');
    expect(takebackRefusalMessage({ reason: 'cooling_down', movesLeft: 2 }))
      .toBe('You can take another move back in 2 moves.');
  });

  it('says plainly when the budget is gone', () => {
    expect(takebackRefusalMessage({ reason: 'no_takebacks_left' })).toBe('No takebacks left this game.');
  });

  it('warns on the card when the next one would stop the game counting', () => {
    const check = { allowed: true, remaining: 2 };
    expect(takebackNote({ check, willCount: true, opponentName: 'Pip' })).toBe('2 left');
    expect(takebackNote({ check, willCount: false, opponentName: 'Pip' }))
      .toBe("won't count against Pip");
    expect(takebackNote({ check: { allowed: false, reason: 'no_takebacks_left', remaining: 0 }, willCount: false }))
      .toBe('none left');
  });
});

describe('counting the player own moves', () => {
  it('counts only theirs', () => {
    const history = [{ color: 'w' }, { color: 'b' }, { color: 'w' }];
    expect(playerMoveCount(history, 'w')).toBe(2);
    expect(playerMoveCount(history, 'b')).toBe(1);
    expect(playerMoveCount(null, 'w')).toBe(0);
  });
});
