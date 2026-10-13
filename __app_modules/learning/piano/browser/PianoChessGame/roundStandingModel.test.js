import { describe, expect, it } from 'vitest';
import { gateSentence, roundHeading, standingRows } from './roundStandingModel.js';

const standing = (over = {}) => ({
  round: 2, level: 1, counted: 2, practice: 4,
  gateWins: 2, gateNeeded: 5, gateWindow: 7, remaining: 3,
  promotes: false, atTop: false, ...over,
});

describe('standingRows', () => {
  it('draws every win, in two rows, without losing any of them', () => {
    const rows = standingRows(standing());
    expect(rows.map((r) => [r.label, r.filled])).toEqual([
      ['Match wins', 2], ['Practice wins', 4],
    ]);
    // Six wins on screen. "I beat him six times" has to be answerable with yes.
    expect(rows.reduce((sum, r) => sum + r.filled, 0)).toBe(6);
  });

  it('returns an empty Match wins row rather than hiding it', () => {
    // A row that only appears once you have one is a row nobody can aim at.
    expect(standingRows(standing({ counted: 0, practice: 0 }))[0])
      .toMatchObject({ key: 'counted', filled: 0 });
  });

  it('never calls a practice win a failure', () => {
    const practice = standingRows(standing()).find((r) => r.key === 'practice');
    expect(practice.label).toBe('Practice wins');
    expect(`${practice.label} ${practice.note}`).not.toMatch(/fail|invalid|didn't count|doesn't count|void/i);
  });
});

describe('gateSentence', () => {
  it('states the form and what is left, in tournament words', () => {
    expect(gateSentence(standing(), { nextName: 'Rattata' }))
      .toBe("Right now: 2 of your last 7 count. 3 more wins on your own and you're through to Rattata.");
  });

  it('never says unlock', () => {
    const all = [
      gateSentence(standing(), { nextName: 'Rattata' }),
      gateSentence(standing({ promotes: true }), { nextName: 'Rattata' }),
      gateSentence(standing({ atTop: true }), {}),
      gateSentence(standing({ gateWins: 0, remaining: 5 }), { nextName: 'Rattata' }),
    ];
    for (const line of all) expect(line).not.toMatch(/unlock/i);
  });

  it('reads naturally at zero rather than saying "0 of your last 7"', () => {
    expect(gateSentence(standing({ gateWins: 0, remaining: 5 }), { nextName: 'Rattata' }))
      .toBe("None of your last 7 matches count yet. 5 more wins on your own and you're through to Rattata.");
  });

  it('says one win singular', () => {
    expect(gateSentence(standing({ gateWins: 4, remaining: 1 }), { nextName: 'Rattata' }))
      .toMatch(/1 more win on your own/);
  });

  it('announces going through, and the top of the ladder', () => {
    expect(gateSentence(standing({ promotes: true }), { nextName: 'Rattata' }))
      .toBe("You're through to Rattata.");
    expect(gateSentence(standing({ atTop: true }), {})).toMatch(/no one left in the ring/);
  });

  it('still reads without a next opponent name', () => {
    expect(gateSentence(standing(), {})).toMatch(/through to the next round/);
  });
});

describe('roundHeading', () => {
  it('names the round and who is in it', () => {
    expect(roundHeading(standing(), { opponentName: 'Weedle' })).toBe('Round 2 — Weedle');
    expect(roundHeading(standing(), {})).toBe('Round 2');
  });
});
