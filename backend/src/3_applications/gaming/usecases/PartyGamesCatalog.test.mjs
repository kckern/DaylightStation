// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PartyGamesCatalog } from './PartyGamesCatalog.mjs';

const publicResourceUrl = (ref) => ref?.kind === 'user-avatar' ? `/api/v1/static/users/${ref.userId}` : null;

const NOOP = { info() {}, warn() {}, error() {}, debug() {} };
const HOUSEHOLD_CFG = {
  buzzers: [{ id: 'living_room', mqtt_topic: 'zigbee2mqtt/Party Games Buzzers', buttons: { '1_single': 'slot_1' } }],
  team_presets: [{ id: 'family', teams: [{ name: 'One', members: ['learner2'] }, { name: 'Two', members: ['kckern', 'ghost_user'] }] }],
  defaults: { timer_seconds: 15 }, sounds: { pack: 'classic' },
};

function makeService({ cfg = HOUSEHOLD_CFG } = {}) {
  const userService = {
    getProfile: (id) => id === 'ghost_user' ? null : id === 'kckern'
      ? { username: id, display_name: 'KC Kern', group_label: 'Dad' }
      : { username: id, display_name: id.toUpperCase() },
  };
  const definitions = new Map([
    ['quiz:night', { definition: { experience: { id: 'quiz', version: 1 } }, parts: { content: { artifact: {}, title: 'Fixture Night', description: 'Questions' } } }],
    ['drawing:family', { definition: { experience: { id: 'drawing', version: 2 } }, parts: { content: { artifact: {}, catalog: { title: 'Draw Together', description: 'Prompts' } } } }],
    ['solo:private', { definition: { experience: { id: 'solo', version: 1 } }, parts: { content: { artifact: {}, title: 'Not Party Games' } } }],
    ['quiz:broken', { definition: { experience: { id: 'quiz', version: 1 } }, parts: { content: { artifact: {} } } }],
  ]);
  const definitionStore = {
    listIds: () => [...definitions.keys()],
    getCurrent: (id) => definitions.get(id) || null,
    getContent: (id) => Object.fromEntries(Object.entries(definitions.get(id)?.parts.content || {}).filter(([key]) => key !== 'artifact')),
  };
  const manifests = new Map([
    ['quiz@1', {
      id: 'quiz', version: 1, theme: { id: 'quiz-show' },
      input_profile: { gamepad: 'host-and-buzzer' }, lifecycle_capabilities: ['teams', 'scores'],
      surfaces: [{ id: 'party-games', presenter: 'quiz-board', inputs: ['keyboard', 'gamepad'] }], setup: { kind: 'teams' },
    }],
    ['drawing@2', { id: 'drawing', version: 2, surfaces: [{ id: 'party-games', presenter: 'drawing-stage' }], setup: { kind: 'individuals-or-teams' } }],
    ['solo@1', { id: 'solo', version: 1, surfaces: [{ id: 'school', presenter: 'solo-view' }] }],
  ]);
  const manifestStore = { get: (id, version) => manifests.get(`${id}@${version}`) || null };
  return new PartyGamesCatalog({ configProjection: { raw: () => cfg }, userService, definitionStore, manifestStore, resourcePresenter: publicResourceUrl, logger: NOOP });
}

describe('PartyGamesCatalog', () => {
  it('hydrates environment-owned members and defaults', () => {
    const config = makeService().getConfig();
    expect(config.team_presets[0].teams[0].members[0]).toEqual({ id: 'learner2', name: 'LEARNER2', avatar: '/api/v1/static/users/learner2' });
    expect(config.team_presets[0].teams[1].members[0].name).toBe('Dad');
    expect(config.team_presets[0].teams[1].members[1]).toEqual({ id: 'ghost_user', name: 'ghost_user', avatar: null });
    expect(config.defaults).toEqual({ timer_seconds: 15, mute: false });
    expect(config.ai).toEqual({ commentary: true, advisory_judgment: true, timeout_ms: 1500 });
  });

  it('tolerates a missing environment profile', () => {
    expect(makeService({ cfg: null }).getConfig()).toMatchObject({ buzzers: [], team_presets: [], defaults: { timer_seconds: 12, mute: false } });
  });

  it('derives every visible entry from mounted definition and manifest metadata', () => {
    const catalog = makeService().listCatalog();
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ definition_id: 'quiz:night', experience_id: 'quiz', title: 'Fixture Night', setup: 'teams', presenter_id: 'quiz-board', valid: true }),
      expect.objectContaining({ definition_id: 'drawing:family', experience_id: 'drawing', title: 'Draw Together', setup: 'individuals-or-teams', valid: true }),
      expect.objectContaining({ definition_id: 'quiz:broken', valid: false, error: 'catalog title is required' }),
    ]));
    expect(catalog.some((entry) => entry.definition_id === 'solo:private')).toBe(false);
    expect(catalog.find((entry) => entry.definition_id === 'quiz:night')).toMatchObject({
      theme: { id: 'quiz-show' },
      input_profile: { gamepad: 'host-and-buzzer' },
      lifecycle_capabilities: ['teams', 'scores'],
      inputs: ['keyboard', 'gamepad'],
    });
  });

  it('returns mounted content only through its matching experience reference', () => {
    const service = makeService();
    expect(service.listSets('quiz').map((entry) => entry.definition_id)).toEqual(['quiz:night', 'quiz:broken']);
    expect(service.getSet('quiz', 'night')).toMatchObject({ title: 'Fixture Night' });
    expect(() => service.getSet('drawing', 'night')).toThrow(/not found/);
    expect(() => service.getSet('../../etc', 'x')).toThrow(/invalid content/);
  });
});
