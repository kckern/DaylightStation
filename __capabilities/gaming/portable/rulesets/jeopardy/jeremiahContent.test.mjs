// @vitest-environment node
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { validateGameSet } from './content.mjs';
import { validateJeopardyDefinition } from './index.mjs';
const raw = yaml.load(readFileSync(new URL('../../../../../tests/_fixtures/group-play/jeremiah-open-book.yml', import.meta.url), 'utf8'));
const regular = raw.rounds.flatMap(r => r.categories.flatMap(c => c.clues));
describe('reviewed Jeremiah open-book pack', () => {
  it('all_31_questions_have_references', () => {
    expect(regular).toHaveLength(30);
    expect(raw.open_book).toBe(true);
    for (const clue of [...regular, raw.final]) expect(clue.scripture_reference?.trim()).toBeTruthy();
    for (const validate of [validateGameSet, validateJeopardyDefinition]) expect(validate(raw)).toMatchObject({ valid: true, errors: [] });
  });
  it('retains_family_game_structure', () => {
    expect(raw.rounds).toHaveLength(2);
    expect(raw.rounds.map(r => r.multiplier)).toEqual([1, 2]);
    for (const round of raw.rounds) {
      expect(round).toMatchObject({ mode: 'turns', penalize_wrong: false });
      expect(round.timer_seconds).toBeUndefined();
      expect(round.categories).toHaveLength(5);
      for (const category of round.categories) expect(category.clues.map(c => c.value)).toEqual([100, 200, 300]);
    }
    expect(regular.filter(c => c.little_kids)).toHaveLength(5);
    expect(regular.filter(c => c.daily_double)).toHaveLength(2);
    expect(regular.filter(c => c.media)).toHaveLength(4);
  });
  it('uses_reviewed_categories_and_final', () => {
    expect(raw.rounds.flatMap(r => r.categories.map(c => c.name)).slice(0, 6)).toEqual(['Jeremiah’s Calling', 'At the Workshop', 'Pictures of Trust', 'Speaking for God', 'Messages to Judah', 'Promises and Tears']);
    expect(raw.final).toMatchObject({ category: 'Hope for the Future', scripture_reference: 'Jeremiah 32:15', answer: 'What are houses, fields, and vineyards?' });
  });
});
