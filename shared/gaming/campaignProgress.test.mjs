import fs from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildPokemonCampaignProgress, createInitialState } from './index.mjs';

const definition = YAML.parse(fs.readFileSync(new URL('./definitions/card-game.yml', import.meta.url), 'utf8'));

function session({ id, day, completed = [], attempts = [], events = [], partnerId = 'bulbasaur', status = 'active' }) {
  const state = createInitialState(definition, {
    seed: 7, participants: [{ user_id: 'kid-1' }], setup: { partner_id: partnerId },
  });
  state.completed_encounters = completed;
  state.practice_attempts = attempts;
  return {
    session_id: id, game_id: 'card-game', status, setup: { partner_id: partnerId }, state, events,
    created_at: `${day}T12:00:00.000Z`, updated_at: `${day}T12:30:00.000Z`,
    completed_at: status === 'complete' ? `${day}T12:30:00.000Z` : null,
  };
}

describe('Card Game longitudinal projection', () => {
  it('reconciles Pokédex, daily research, trainer XP, bonds, and active resume data', () => {
    const monday = session({
      id: 'game_monday', day: '2026-08-10', completed: ['pidgey', 'meowth'],
      attempts: [{ kind: 'chord', status: 'completed', score: 0.8 }],
      events: [
        { type: 'encounter_completed', encounter_id: 'pidgey', occurred_at: '2026-08-10T12:20:00.000Z' },
        { type: 'encounter_completed', encounter_id: 'meowth', occurred_at: '2026-08-10T12:25:00.000Z' },
        { type: 'recruit_selected', recruit_id: 'meowth' },
      ],
    });
    monday.state.recruitment_choices = [{ after_encounter: 2, recruit_id: 'meowth' }];
    const tuesday = session({
      id: 'game_tuesday', day: '2026-08-11', completed: ['pikachu'],
      attempts: [{ kind: 'arpeggio', status: 'completed', score: 0.82 }],
      events: [{ type: 'encounter_completed', encounter_id: 'pikachu', occurred_at: '2026-08-11T12:20:00.000Z' }],
    });
    const progress = buildPokemonCampaignProgress({
      definition, sessions: [monday, tuesday], userId: 'kid-1',
      now: new Date('2026-08-11T15:00:00'), activeSession: tuesday,
    });
    expect(progress).toMatchObject({
      persistent: true,
      campaign: { active_session: { session_id: 'game_tuesday', partner_id: 'bulbasaur' } },
      daily: { featured_skill: 'arpeggio', battle_complete: true, skill_complete: true, completed: true },
      weekly: { stamp_count: 2 },
      trainer: { level: 1 },
    });
    expect(progress.trainer.xp).toBe(130); // three seen + one catch + two daily reports
    expect(progress.bonds.bulbasaur).toMatchObject({ rank: 2, wins: 3, days: 2 });
    expect(progress.pokedex.entries.find((entry) => entry.id === 'meowth')).toMatchObject({ caught: true, status: 'caught' });
    expect(progress.applied_milestone_ids).toContain('catch:meowth');
  });

  it('does not derive durable rewards for guest sessions', () => {
    const guest = buildPokemonCampaignProgress({
      definition,
      sessions: [session({ id: 'game_guest', day: '2026-08-11', completed: ['pidgey'] })],
      userId: 'guest', now: new Date('2026-08-11T15:00:00'),
    });
    expect(guest).toMatchObject({ persistent: false, trainer: { xp: 0 }, journeys_completed: 0 });
    expect(guest.badges).toEqual([]);
  });
});
