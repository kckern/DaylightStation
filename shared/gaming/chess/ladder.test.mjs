import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LADDER_POLICY, DEFAULT_ROSTER, LADDER_SIZE, TOP_LEVEL, describeLevel,
  applyGameToProgress, availableOpponents, countsTowardPromotion, createLadderProgress,
  normalizeProgress, promotionStatus, resolvePolicy, resolveRoster, rungForLevel,
} from './ladder.mjs';

const POLICY = DEFAULT_LADDER_POLICY;
const game = (over = {}) => ({ completed: true, result: 'win', level: 0, help: { hints: 0, best_moves: 0 }, ...over });

/** Play a sequence of results and return the resulting progress. */
function climb(results, policy = POLICY, start = createLadderProgress()) {
  let progress = start;
  for (const entry of results) {
    ({ progress } = applyGameToProgress(progress, game({ level: progress.unlocked_through, ...entry }), policy));
  }
  return progress;
}

describe('the roster', () => {
  it('has one character per engine skill level', () => {
    expect(DEFAULT_ROSTER).toHaveLength(LADDER_SIZE);
    expect(DEFAULT_ROSTER.map((p) => p.level)).toEqual([...Array(LADDER_SIZE).keys()]);
    expect(new Set(DEFAULT_ROSTER.map((p) => p.name)).size).toBe(LADDER_SIZE);
  });

  it('can be replaced wholesale from config, which is how Pokemon get in', () => {
    const roster = resolveRoster({ ladder: { roster: [{ name: 'Magikarp', art: '/magikarp.png' }, 'Rattata'] } });
    expect(roster[0]).toMatchObject({ level: 0, name: 'Magikarp', art: '/magikarp.png' });
    expect(roster[1]).toMatchObject({ level: 1, name: 'Rattata', art: null });
    // A renamed character keeps the level's board tint unless it sets its own.
    expect(roster[1].theme).toBe(DEFAULT_ROSTER[1].theme);
    expect(resolveRoster({ ladder: { roster: [{ name: 'Onix', theme: '#334455' }] } })[0].theme).toBe('#334455');
    // A short override fills from the house roster rather than leaving holes —
    // otherwise the top of the ladder would be unreachable and nothing on
    // screen would say why.
    expect(roster).toHaveLength(LADDER_SIZE);
    expect(roster[20].name).toBe(DEFAULT_ROSTER[20].name);
  });

  it('picks a named pack, so each child selects a roster instead of copying one', () => {
    const config = {
      ladder: {
        roster_pack: 'pokemon',
        rosters: { pokemon: [{ name: 'Caterpie', art: '/caterpie.svg' }] },
      },
    };
    expect(resolveRoster(config)[0].name).toBe('Caterpie');
    // An unknown pack name falls back rather than emptying the ladder.
    expect(resolveRoster({ ladder: { roster_pack: 'nope', rosters: {} } })).toBe(DEFAULT_ROSTER);
  });

  it('falls back to the house roster when the override is unusable', () => {
    expect(resolveRoster({})).toBe(DEFAULT_ROSTER);
    expect(resolveRoster({ ladder: { roster: [] } })).toBe(DEFAULT_ROSTER);
    expect(resolveRoster(null)).toBe(DEFAULT_ROSTER);
  });
});

describe('the board theme', () => {
  it('gives every character a distinct tint that deepens up the ladder', () => {
    const themes = DEFAULT_ROSTER.map((p) => p.theme);
    expect(new Set(themes).size, 'two opponents must not look identical').toBe(LADDER_SIZE);
    // Lightness falls monotonically: the ladder gets visibly darker as it climbs.
    const lightness = themes.map((t) => Number(/(\d+)%\)$/.exec(t)[1]));
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i], `level ${i} must not be lighter than ${i - 1}`).toBeLessThan(lightness[i - 1]);
    }
  });

  it('is cosmetic — it never reaches the promotion arithmetic', () => {
    const themed = resolveRoster({ ladder: { roster: [{ name: 'Pip', theme: 'red' }] } });
    const plain = resolveRoster({});
    const policy = resolvePolicy({});
    // Same climb, themed or not.
    expect(promotionStatus({ unlocked_through: 0, results: [] }, policy))
      .toEqual(promotionStatus({ unlocked_through: 0, results: [] }, policy));
    expect(themed).toHaveLength(plain.length);
  });
});

describe('what a character is like', () => {
  it('describes every rung, so the ones ahead are something to work towards', () => {
    for (let level = 0; level < LADDER_SIZE; level += 1) {
      expect(describeLevel(level), `level ${level}`).toBeTruthy();
    }
    expect(new Set(Array.from({ length: LADDER_SIZE }, (_, i) => describeLevel(i))).size).toBe(LADDER_SIZE);
  });

  it('clamps rather than returning nothing off the ends', () => {
    expect(describeLevel(-3)).toBe(describeLevel(0));
    expect(describeLevel(99)).toBe(describeLevel(TOP_LEVEL));
  });
});

describe('the promotion policy', () => {
  it('comes from config, with the house defaults underneath', () => {
    const policy = resolvePolicy({ ladder: { promotion: { window: 10, wins_required: 8 } } });
    expect(policy.window).toBe(10);
    expect(policy.wins_required).toBe(8);
    expect(policy.max_best_moves).toBe(DEFAULT_LADDER_POLICY.max_best_moves);
  });

  it('never demands more wins than the window can hold', () => {
    // Otherwise a typo strands every player on level 0 forever, with no visible
    // cause — the failure would look like the game being broken.
    expect(resolvePolicy({ ladder: { promotion: { window: 3, wins_required: 9 } } }).wins_required).toBe(3);
  });
});

describe('which games count', () => {
  it('counts a clean, finished game against the current opponent', () => {
    expect(countsTowardPromotion(game(), POLICY, 0)).toBe(true);
  });

  it('never counts an unfinished game', () => {
    expect(countsTowardPromotion(game({ completed: false }), POLICY, 0)).toBe(false);
  });

  it('never counts a game where the engine was asked for the best move', () => {
    // That game was partly played by the engine; promoting on it would certify
    // a skill nobody has.
    expect(countsTowardPromotion(game({ help: { hints: 0, best_moves: 1 } }), POLICY, 0)).toBe(false);
  });

  it('allows a single orienting hint but not a game leant on', () => {
    expect(countsTowardPromotion(game({ help: { hints: 1, best_moves: 0 } }), POLICY, 0)).toBe(true);
    expect(countsTowardPromotion(game({ help: { hints: 2, best_moves: 0 } }), POLICY, 0)).toBe(false);
  });

  it('never counts a game against anyone but the opponent being climbed', () => {
    // Replaying a beaten character is practice, and practice earns nothing.
    expect(countsTowardPromotion(game({ level: 0 }), POLICY, 3)).toBe(false);
  });
});

describe('climbing', () => {
  it('promotes on five wins in the last seven', () => {
    const progress = climb([
      { result: 'win' }, { result: 'loss' }, { result: 'win' },
      { result: 'win' }, { result: 'loss' }, { result: 'win' },
    ]);
    expect(progress.unlocked_through).toBe(0);
    const after = applyGameToProgress(progress, game({ level: 0 }), POLICY);
    expect(after.promoted).toBe(true);
    expect(after.to).toBe(1);
  });

  it('does not promote on a lifetime tally spread beyond the window', () => {
    // Five wins overall, but four losses in between push the early ones out of
    // the last seven — recent form, not a career total.
    const progress = climb([
      { result: 'win' }, { result: 'win' },
      { result: 'loss' }, { result: 'loss' }, { result: 'loss' }, { result: 'loss' },
      { result: 'win' }, { result: 'win' }, { result: 'win' },
    ]);
    expect(progress.unlocked_through).toBe(0);
    expect(promotionStatus(progress, POLICY).wins).toBe(3);
  });

  it('never demotes, however badly it goes afterwards', () => {
    let progress = climb(Array(5).fill({ result: 'win' }));
    expect(progress.unlocked_through).toBe(1);
    progress = climb(Array(9).fill({ result: 'loss' }), POLICY, progress);
    expect(progress.unlocked_through, 'a bad afternoon must not take a rung back').toBe(1);
  });

  it('starts the new opponent with a clean window', () => {
    const progress = climb(Array(5).fill({ result: 'win' }));
    const status = promotionStatus(progress, POLICY);
    expect(status.level).toBe(1);
    expect(status.played, 'wins against the beaten opponent must not carry forward').toBe(0);
    expect(status.wins).toBe(0);
  });

  it('remembers uncounted games without letting them promote', () => {
    const progress = climb(Array(7).fill({ result: 'win', help: { hints: 0, best_moves: 3 } }));
    expect(progress.unlocked_through).toBe(0);
    expect(progress.results).toHaveLength(7);
    expect(progress.results.every((entry) => entry.counted === false)).toBe(true);
  });

  it('stops at the top rather than running off the end', () => {
    let progress = { unlocked_through: TOP_LEVEL, results: [] };
    for (let i = 0; i < 9; i += 1) {
      ({ progress } = applyGameToProgress(progress, game({ level: TOP_LEVEL }), POLICY));
    }
    expect(progress.unlocked_through).toBe(TOP_LEVEL);
    expect(promotionStatus(progress, POLICY).at_top).toBe(true);
  });

  it('keeps history bounded for a child who plays this for years', () => {
    let progress = createLadderProgress();
    for (let i = 0; i < 800; i += 1) {
      ({ progress } = applyGameToProgress(progress, game({ level: progress.unlocked_through, result: 'loss' }), POLICY));
    }
    expect(progress.results.length).toBeLessThanOrEqual(POLICY.window * LADDER_SIZE);
  });
});

describe('no skipping ahead', () => {
  it('offers only the opponents up to the one being climbed', () => {
    const roster = resolveRoster({});
    expect(availableOpponents({ unlocked_through: 0, results: [] }, roster)).toHaveLength(1);
    expect(availableOpponents({ unlocked_through: 4, results: [] }, roster)).toHaveLength(5);
    expect(availableOpponents({ unlocked_through: TOP_LEVEL, results: [] }, roster)).toHaveLength(LADDER_SIZE);
  });
});

describe('stored progress', () => {
  it('reads a damaged file as a fresh climber rather than throwing', () => {
    expect(normalizeProgress(null)).toEqual(createLadderProgress());
    expect(normalizeProgress('nonsense')).toEqual(createLadderProgress());
    expect(normalizeProgress({ results: 'not a list' }).results).toEqual([]);
  });

  it('clamps a level that is out of range instead of trusting it', () => {
    // Hand-editable YAML: a typo must not hand someone the top of the ladder,
    // and must not put them below the bottom of it either.
    expect(normalizeProgress({ unlocked_through: 999 }).unlocked_through).toBe(TOP_LEVEL);
    expect(normalizeProgress({ unlocked_through: -4 }).unlocked_through).toBe(0);
  });
});

describe('engine settings', () => {
  it('maps a level straight onto the engine skill it names', () => {
    expect(rungForLevel(0, POLICY).skill).toBe(0);
    expect(rungForLevel(20, POLICY).skill).toBe(20);
    expect(rungForLevel(99, POLICY).skill).toBe(TOP_LEVEL);
    expect(rungForLevel(-3, POLICY).skill).toBe(0);
  });
});
