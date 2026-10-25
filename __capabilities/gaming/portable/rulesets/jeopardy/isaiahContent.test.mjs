// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { validateGameSet, validateJeopardyDefinition, jeopardyRuleModule } from './index.mjs';
import { YamlGamingDefinitionStore } from '../../../../../__app_modules/games/party-games/server/adapters/persistence/YamlGamingDefinitionStore.mjs';
const fixture = new URL('../../../../../tests/_fixtures/group-play/isaiah-practice/', import.meta.url);
const load = name => yaml.load(fs.readFileSync(new URL(name, fixture), 'utf8'));
describe('Isaiah open-book practice artifacts', () => {
  it('composes real artifact identities and a fresh anonymous-team game', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isaiah-practice-'));
    try {
      const dir = path.join(root, 'jeopardy:practice-isaiah'); fs.mkdirSync(dir);
      for (const name of ['rules.yml', 'content.yml']) fs.copyFileSync(new URL(name, fixture), path.join(dir, name));
      expect(load('rules.yml').artifact).toEqual({ kind: 'gaming-rules', version: 1, id: 'jeopardy:practice-isaiah' });
      expect(load('content.yml').artifact).toEqual({ kind: 'gaming-content', version: 1, id: 'jeopardy:practice-isaiah' });
      const store = new YamlGamingDefinitionStore({ definitionsDir: root, archiveDir: path.join(root, 'archive') });
      expect(load('rules.yml').party_games).toEqual({ setup_revision: 'guest-teams-v1', anonymous_teams: [{ name: 'Blue Team', color: '#3273dc' }, { name: 'Gold Team', color: '#e6b325' }] });
      const definition = store.getCurrent('jeopardy:practice-isaiah').definition;
      const state = jeopardyRuleModule.createInitialState(definition, { seats: [{ id: 'blue', members: [] }, { id: 'gold', members: [] }] });
      expect(state).toMatchObject({ scores: { blue: 0, gold: 0 }, used: {}, phase: 'round-intro' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('retains all 31 references through both validators and normalization', () => {
    const raw = load('content.yml');
    const clues = [...raw.rounds.flatMap(r => r.categories.flatMap(c => c.clues)), raw.final];
    expect(clues).toHaveLength(31);
    expect(new Set(clues.map(c => c.scripture_reference)).size).toBe(31);
    expect(new Set(clues.map(c => c.clue)).size).toBe(31);
    for (const c of clues) { expect(c.scripture_reference).toMatch(/^Isaiah \d+:\d+$/); expect(c.answer.trim()).toBeTruthy(); }
    for (const validate of [validateGameSet, validateJeopardyDefinition]) expect(validate(raw)).toMatchObject({ valid: true, errors: [] });
    const normalized = validateGameSet(raw).set;
    expect(normalized.open_book).toBe(true);
    expect([...normalized.rounds.flatMap(r => r.categories.flatMap(c => c.clues)), normalized.final].map(c => c.scripture_reference)).toEqual(clues.map(c => c.scripture_reference));
  });
  it('keeps the family board structure and answer-free category labels', () => {
    const raw = load('content.yml');
    expect(raw.id).toBe('practice-isaiah'); expect(raw.title).toBe('Isaiah Practice Jeopardy'); expect(raw.open_book).toBe(true);
    expect(raw.rounds.map(r => r.multiplier)).toEqual([1, 2]);
    for (const [ri, round] of raw.rounds.entries()) {
      expect(round).toMatchObject({ mode: 'turns', penalize_wrong: false }); expect(round.timer_seconds).toBeUndefined(); expect(round.categories).toHaveLength(5);
      for (const cat of round.categories) {
        expect(cat.clues.map(c => c.value)).toEqual([100, 200, 300]);
        for (const clue of cat.clues) {
          expect(Boolean(clue.little_kids)).toBe(ri === 0 && clue.value === 100);
          const words = clue.answer.toLowerCase().replace(/^(what|who) (is|are) /, '').match(/[a-z]+/g).filter(w => !['a','an','the','his','my','of','to','and','me'].includes(w));
          for (const word of words) expect(cat.name.toLowerCase().match(/[a-z]+/g)).not.toContain(word);
        }
      }
      expect(round.categories.flatMap(c => c.clues).filter(c => c.daily_double)).toHaveLength(1);
    }
  });
  it('keeps the trust answer and ruler title out of other visible clue text', () => {
    const raw = load('content.yml');
    const categories = raw.rounds.flatMap(r => r.categories);
    const clues = categories.flatMap(c => c.clues);
    const eagle = clues.find(c => c.scripture_reference === 'Isaiah 40:31');
    const trust = clues.find(c => c.scripture_reference === 'Isaiah 26:3');
    expect(trust.answer).toMatch(/trust in the Lord/);
    expect(eagle.clue).not.toMatch(/trust/i);
    expect(clues.find(c => c.scripture_reference === 'Isaiah 9:6').clue).not.toMatch(/advis[eo]r|counsell?or|wonderful/i);
    expect(categories.find(c => c.clues.some(q => q.scripture_reference === 'Isaiah 40:8')).name).toBe('Enduring Guidance');
    expect(categories.find(c => c.clues.some(q => q.scripture_reference === 'Isaiah 42:3')).name).toBe('Gentle Deliverance');
    for (const answer of ['wolves', 'plows', 'figs', 'eagles', 'tears', 'cobras', 'wells', 'mountains']) {
      expect(clues.find(c => c.answer.includes(answer)).answer).toBe(`What are ${answer}?`);
    }
    expect(clues.find(c => c.scripture_reference === 'Isaiah 6:8').answer).toBe('What is “Here I am. Send me!”?');
  });

});
