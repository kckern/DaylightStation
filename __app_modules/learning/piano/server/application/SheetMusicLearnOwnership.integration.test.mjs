// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let files = {};
const atomicWrites = vi.fn((path, data) => { files[path.replace(/\.ya?ml$/, '')] = structuredClone(data); });
vi.mock('../../../../../__backend/src/0_system/utils/FileIO.mjs', () => ({
  loadYaml: (path) => files[path] ?? null,
  saveYamlToPathAtomic: (...args) => atomicWrites(...args),
  saveYaml: () => {},
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: () => {},
  writeBinary: () => {},
  listFiles: () => [],
  listDirs: () => [],
  readFile: () => null,
  getStats: () => null,
}));

import { SheetMusicAdminService, draftRevision } from './SheetMusicAdminService.mjs';
import { YamlPianoStudioDatastore } from '../adapters/YamlPianoStudioDatastore.mjs';
import { practiceKeyOfScore } from '../../portable/music/practiceKey.mjs';

const SCORE_A = 'files:docs/sheet-music/classical/lesson-one.musicxml';
const SCORE_B = 'files:docs/sheet-music/classical/lesson_one.musicxml';
const SEGMENTS_A = [{ id: 'a', start: 0, end: 7, parts: ['rh', 'lh'] }];
const configService = {
  getHouseholdPath: (path) => `/data/household/${path}`,
  getMediaDir: () => '/data/media',
};

beforeEach(() => { files = {}; atomicWrites.mockClear(); });

describe('SheetMusicAdminService Learn record ownership', () => {
  it('keeps a colliding score from reading or overwriting the existing approved record', async () => {
    expect(practiceKeyOfScore(SCORE_A)).toBe(practiceKeyOfScore(SCORE_B));
    const datastore = new YamlPianoStudioDatastore({ configService });
    const service = new SheetMusicAdminService({
      datastore,
      scoreReader: { read: async () => ({ xml: '<score-partwise/>', contentSha256: 'sha-current' }) },
      listScores: () => [],
      listLearners: () => [],
      fileSignature: () => null,
    });

    const draft = await service.saveDraft(SCORE_A, { segments: SEGMENTS_A, measureCount: 8 });
    await service.approve(SCORE_A, { measureCount: 8, expectedDraftRevision: draftRevision(SEGMENTS_A) });
    const approvedBefore = structuredClone(datastore.getSheetMusicLearn(SCORE_A));
    expect(approvedBefore).toMatchObject({ scoreId: SCORE_A, segments: SEGMENTS_A });
    const writeCount = atomicWrites.mock.calls.length;

    await expect(service.getLearn(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.draftImpact(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.saveDraft(SCORE_B, { segments: [{ id: 'b', start: 0, end: 3 }], measureCount: 8 }))
      .rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.approve(SCORE_B, { measureCount: 8, expectedDraftRevision: draftRevision(SEGMENTS_A) }))
      .rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.revert(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });

    expect(atomicWrites).toHaveBeenCalledTimes(writeCount);
    expect(datastore.getSheetMusicLearn(SCORE_A)).toEqual(approvedBefore);
  });
});
