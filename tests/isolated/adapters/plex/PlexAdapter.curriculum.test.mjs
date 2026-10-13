import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlexAdapter } from "../../../../__capabilities/content-catalog/server/adapters/providers/plex/PlexAdapter.mjs";
import { pianoCurriculumEnrichment } from "../../../../__app_modules/learning/piano/server/composition/plex-curriculum.mjs";
import { _resetCacheForTests, configureCurriculumDir } from "../../../../__app_modules/learning/piano/server/adapters/plex-curriculum/CurriculumIndex.mjs";

// Synthetic curriculum (tests/_fixtures/piano/sample-curriculum.json) staged in a temp data dir;
// the real per-show file is household data under <data>/content/piano/curriculum.
const SHOW = '900001';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curriculum-'));
fs.copyFileSync(new URL('../../../_fixtures/piano/sample-curriculum.json', import.meta.url), path.join(dir, `${SHOW}.json`));
function adapter() { return new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) }, curriculumEnrichment: pianoCurriculumEnrichment }); }

describe('PlexAdapter curriculum merge', () => {
  beforeEach(() => { configureCurriculumDir(dir); _resetCacheForTests(); });
  afterAll(() => configureCurriculumDir(null));

  it('episode in an indexed show gets corrected title + metadata.piano', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '1', title: 'Raw Plex Title',
      grandparentRatingKey: SHOW, parentIndex: 8, index: 1, Media: [] });
    expect(item.title).toBe('Intro');
    expect(item.metadata.piano.course).toBe("Sample Tune");
    expect(item.metadata.piano.styles).toContain('Jazz Ballads');
  });

  it('season in an indexed show gets the lane block', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'season', ratingKey: '677395', title: 'Song Library',
      parentRatingKey: SHOW, index: 8 });
    expect(item.metadata.piano.lane).toBe('repertoire');
    expect(item.metadata.piano.kind).toBeUndefined();
  });

  it('item in a non-indexed show is untouched (no piano)', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '9', title: 'Ep', grandparentRatingKey: '999999', parentIndex: 1, index: 1, Media: [] });
    expect(item.metadata.piano).toBeUndefined();
  });
});
