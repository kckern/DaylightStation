import { describe, it, expect } from 'vitest';
import { GetContentFilter } from './GetContentFilter.mjs';

const refined = {
  timebase: { clock: 'vidangel' },
  certification: { level: 'machine', machine: { at: '2026-11-07' } },
  cues: [{ id: 'va1', type: 'mute', in: 100.2, out: 100.6, precision: 'ms' }],
};
const repo = (override) => ({
  getEdl: async () => ({ sourceRef: { workId: 1, tagSetId: 2 }, cues: [] }),
  getRefinedEdl: async () => refined,
  getProfile: async () => ({ requiresCertification: 'machine' }),
  getOverride: async () => override,
});

describe('GetContentFilter certification with nudges', () => {
  it('is ready when no nudge uncovers a word', async () => {
    const r = await new GetContentFilter({ contentFilterRepository: repo({ cueOverrides: { va1: { startMs: 100100, endMs: 100700 } } }) }).execute({ ratingKey: '1' });
    expect(r.certification).toEqual({ level: 'machine', requires: 'machine', ready: true });
  });
  it('is not ready when a nudge uncovers a word', async () => {
    const r = await new GetContentFilter({ contentFilterRepository: repo({ cueOverrides: { va1: { startMs: 100300, endMs: 100700 } } }) }).execute({ ratingKey: '1' });
    expect(r.certification.ready).toBe(false);
    expect(r.certification.level).toBe('none');
  });
});
