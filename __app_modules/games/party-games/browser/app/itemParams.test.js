import { describe, it, expect } from 'vitest';
import { launchFromParams, presentationFor, seatedParticipantIds, validClueModes } from './itemParams.js';

describe('Charades item params', () => {
  it('maps autostart and participants onto launch overrides', () => {
    expect(launchFromParams({ autostart: true, participants: ['learner-a', 'learner-b'] })).toEqual({ autostart: true, participants: ['learner-a', 'learner-b'] });
  });
  it('ignores malformed values', () => {
    expect(launchFromParams({ autostart: 'yes', participants: 'learner-a' })).toEqual({});
    expect(launchFromParams({ participants: ['learner-a', ''] })).toEqual({});
    expect(launchFromParams(undefined)).toEqual({});
  });
  it('builds a presentation covering every seated participant, defaulting to text', () => {
    expect(presentationFor({ clue_modes: { 'learner-a': 'reader', 'learner-b': 'image', ghost: 'image' } }, ['adult-a', 'learner-a', 'learner-b']))
      .toEqual({ schema: 'charades-presentation/v1', by_participant: { 'adult-a': 'text', 'learner-a': 'reader', 'learner-b': 'image' } });
  });
  it('treats an unknown clue mode as text', () => {
    expect(presentationFor({ clue_modes: { 'learner-a': 'video', 'learner-b': 'image' } }, ['learner-a', 'learner-b']))
      .toEqual({ schema: 'charades-presentation/v1', by_participant: { 'learner-a': 'text', 'learner-b': 'image' } });
  });
  it('returns null when no seated id has a valid clue mode, so rules.yml still applies', () => {
    expect(presentationFor({ clue_modes: { 'learner-a': 'reader', 'learner-b': 'image' } }, ['team_1', 'team_2'])).toBeNull();
    expect(presentationFor({ clue_modes: { 'learner-a': 'video' } }, ['learner-a'])).toBeNull();
  });
  it('counts only valid clue modes', () => {
    expect(validClueModes({ clue_modes: { 'learner-a': 'reader', 'learner-b': 'video' } })).toEqual({ 'learner-a': 'reader' });
    expect(validClueModes({ clue_modes: ['reader'] })).toEqual({});
  });
  it('returns null without clue modes so the rules.yml presentation applies', () => {
    expect(presentationFor({}, ['learner-a'])).toBeNull();
    expect(presentationFor(undefined, ['learner-a'])).toBeNull();
    expect(presentationFor({ clue_modes: ['reader'] }, ['learner-a'])).toBeNull();
  });
  it('derives seated ids the way the server does: seat ids, not member ids', () => {
    expect(seatedParticipantIds([{ id: 'learner-a', members: [{ id: 'x' }] }, { id: 'learner-b', members: [] }])).toEqual(['learner-a', 'learner-b']);
    expect(seatedParticipantIds([])).toEqual([]);
  });
});
