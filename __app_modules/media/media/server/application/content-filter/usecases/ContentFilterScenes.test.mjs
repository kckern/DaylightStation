import { describe, it, expect } from 'vitest';
import { ContentFilterScenes, cleanCard } from './ContentFilterScenes.mjs';

function memRepo() {
  const state = {
    edl: { sourceRef: { workId: 1, tagSetId: 2 } },
    refined: {
      title: 'Film', sceneCalibration: { situation: 'trusted', picture: 'trusted' },
      cues: [{ id: 'va1', label: 'A man is shot.' }, { id: 'va2', label: 'A kiss.' }],
      scenes: [
        { id: 'sc-va1', in: 100, out: 150, cues: ['va1'], groups: ['violence_blood_gore'], level: { violence_blood_gore: { situation: 2, picture: 2 } } },
        { id: 'sc-va2', in: 300, out: 320, cues: ['va2'], groups: ['sex_any'], level: { sex_any: { situation: 1, picture: 1 } } },
      ],
    },
    profile: { scenes: { violence_blood_gore: { blackout: { picture: 2 } } } },
    override: { sync: { scale: 1, offsetSec: 10, part: '9' } },
    transcript: { segments: [{ s: 100, e: 105, text: 'Run!' }, { s: 165, e: 170, text: 'We made it.' }] },
  };
  return {
    state,
    getEdl: async () => state.edl,
    getRefinedEdl: async () => state.refined,
    saveRefinedEdl: async (_r, e) => { state.refined = e; },
    getTranscript: async () => state.transcript,
    getProfile: async () => state.profile,
    getOverride: async () => state.override,
    saveOverride: async (_rk, o) => { state.override = o; },
  };
}

const clock = () => new Date('2026-11-06T12:00:00Z');
const quiet = { info() {}, warn() {} };

describe('ContentFilterScenes', () => {
  it('lists scenes with the profile effect and member labels', async () => {
    const uc = new ContentFilterScenes({ contentFilterRepository: memRepo(), logger: quiet });
    const { scenes } = await uc.list({ ratingKey: '5' });
    expect(scenes.map((s) => [s.id, s.effect])).toEqual([['sc-va1', 'blackout'], ['sc-va2', null]]);
    expect(scenes[0].tags).toEqual(['A man is shot.']);
    expect(scenes[0].localIn).toBe(110);
  });

  it('drafts cards only for scenes that hide something, with the dialogue around them', async () => {
    const repo = memRepo(); const prompts = [];
    const ai = { chat: async (m, o) => { prompts.push({ m, o }); return '"They escape in the truck."'; } };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, aiGateway: ai, logger: quiet, clock });
    expect(await uc.draftCards({ ratingKey: '5' })).toEqual({ drafted: 1, scenes: 2 });
    expect(repo.state.refined.scenes[0].card).toEqual({ text: 'They escape in the truck.', at: '2026-11-06' });
    expect(repo.state.refined.scenes[1].card).toBeUndefined();
    expect(prompts[0].m[1].content).toContain('Said just after: We made it.');
    expect(prompts[0].o.usageTags).toEqual({ app: 'media', feature: 'content-filter-cards' });
  });

  it('keeps an existing draft unless forced, and rejects an overlong card', async () => {
    const repo = memRepo();
    repo.state.refined.scenes[0].card = { text: 'Old draft.' };
    const ai = { chat: async () => 'x'.repeat(200) };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, aiGateway: ai, logger: quiet, clock });
    expect((await uc.draftCards({ ratingKey: '5' })).drafted).toBe(0);
    expect((await uc.draftCards({ ratingKey: '5', force: true })).drafted).toBe(0);
    expect(repo.state.refined.scenes[0].card.text).toBe('Old draft.');
  });

  it('approves the draft card into the override, and an effect ruling', async () => {
    const repo = memRepo();
    repo.state.refined.scenes[0].card = { text: 'They escape.' };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, logger: quiet, clock });
    await uc.rule({ ratingKey: '5', sceneId: 'sc-va1', card: { approve: true }, by: 'parent' });
    await uc.rule({ ratingKey: '5', sceneId: 'sc-va1', effect: 'skip' });
    expect(repo.state.override.sceneOverrides['sc-va1']).toEqual({ card: { text: 'They escape.', approvedBy: 'parent', at: '2026-11-06' }, effect: 'skip' });
    expect(repo.state.override.sync).toEqual({ scale: 1, offsetSec: 10, part: '9' });
  });

  it('clears a ruling back to the profile and drops an empty entry', async () => {
    const repo = memRepo();
    repo.state.override.sceneOverrides = { 'sc-va1': { effect: 'off' } };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, logger: quiet, clock });
    await uc.rule({ ratingKey: '5', sceneId: 'sc-va1', effect: 'profile' });
    expect(repo.state.override.sceneOverrides).toEqual({});
  });

  it('keeps both of two rulings sent at once (no lost update)', async () => {
    const repo = memRepo();
    const slow = repo.getOverride;
    repo.getOverride = async () => { await new Promise((r) => setTimeout(r, 5)); return slow(); };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, logger: quiet, clock });
    await Promise.all([
      uc.rule({ ratingKey: '5', sceneId: 'sc-va1', effect: 'skip' }),
      uc.rule({ ratingKey: '5', sceneId: 'sc-va2', effect: 'blackout' }),
    ]);
    expect(Object.keys(repo.state.override.sceneOverrides).sort()).toEqual(['sc-va1', 'sc-va2']);
  });

  it('refuses an unknown effect and an unknown scene', async () => {
    const uc = new ContentFilterScenes({ contentFilterRepository: memRepo(), logger: quiet, clock });
    await expect(uc.rule({ ratingKey: '5', sceneId: 'sc-va1', effect: 'explode' })).rejects.toThrow('unknown scene effect');
    expect(await uc.rule({ ratingKey: '5', sceneId: 'nope', effect: 'off' })).toBeNull();
  });
});

describe('ContentFilterScenes workshop', () => {
  it('ruleCue writes an effect, keeps other fields, off = disabled, profile clears, unknown = null', async () => {
    const repo = memRepo();
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, logger: quiet, clock });
    expect(await uc.ruleCue({ ratingKey: '5', cueId: 'va1', effect: 'bleep' })).toEqual({ effect: 'bleep' });
    expect(repo.state.override.cueOverrides.va1).toEqual({ effect: 'bleep' });
    expect(repo.state.override.sync.part).toBe('9');
    await uc.ruleCue({ ratingKey: '5', cueId: 'va1', effect: 'off' });
    expect(repo.state.override.cueOverrides.va1).toEqual({ disabled: true });
    await uc.ruleCue({ ratingKey: '5', cueId: 'va1', effect: 'profile' });
    expect(repo.state.override.cueOverrides).toEqual({});
    expect(await uc.ruleCue({ ratingKey: '5', cueId: 'nope', effect: 'mute' })).toBeNull();
    await expect(uc.ruleCue({ ratingKey: '5', cueId: 'va1', effect: 'explode' })).rejects.toThrow('unknown cue effect');
  });

  it('draftCard asks once with the usage tags and stores the draft on that scene only', async () => {
    const repo = memRepo(); const calls = [];
    const ai = { chat: async (m, o) => { calls.push({ m, o }); return 'They escape.'; } };
    const uc = new ContentFilterScenes({ contentFilterRepository: repo, aiGateway: ai, logger: quiet, clock });
    repo.state.refined.scenes[0].card = { text: 'Old.' };
    expect(await uc.draftCard({ ratingKey: '5', sceneId: 'sc-va1' })).toEqual({ card: { text: 'They escape.', at: '2026-11-06' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].o.usageTags).toEqual({ app: 'media', feature: 'content-filter-cards' });
    expect(repo.state.refined.scenes[0].card.text).toBe('They escape.');
    expect(repo.state.refined.scenes[1].card).toBeUndefined();
    expect(await uc.draftCard({ ratingKey: '5', sceneId: 'nope' })).toBeNull();
  });
});

describe('cleanCard', () => {
  it('trims quotes and whitespace', () => { expect(cleanCard('  “Hi there.” \n')).toBe('Hi there.'); });
  it('rejects empty or too long', () => { expect(cleanCard('')).toBeNull(); expect(cleanCard('a'.repeat(91))).toBeNull(); });
});
