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
  it('does not replace a newer draft when a stale editor saves', async () => {
    const datastore = new YamlPianoStudioDatastore({ configService });
    const service = new SheetMusicAdminService({
      datastore,
      scoreReader: { read: async () => ({ xml: '<score-partwise/>', contentSha256: 'sha-current' }) },
      listScores: () => [],
      listLearners: () => [],
      fileSignature: () => null,
    });
    const first = [{ id: 'whole', start: 0, end: 7 }];
    const savedByOtherTab = [{ id: 'first-half', start: 0, end: 3 }, { id: 'second-half', start: 4, end: 7 }];
    const localEdits = [{ id: 'first-three', start: 0, end: 2 }, { id: 'rest', start: 3, end: 7 }];
    const originalRevision = draftRevision(first);

    await service.saveDraft(SCORE_A, { segments: first, measureCount: 8, expectedDraftRevision: null });
    await service.saveDraft(SCORE_A, { segments: savedByOtherTab, measureCount: 8, expectedDraftRevision: originalRevision });
    const savedBeforeConflict = structuredClone(datastore.getSheetMusicLearn(SCORE_A));
    const writeCount = atomicWrites.mock.calls.length;

    await expect(service.saveDraft(SCORE_A, {
      segments: localEdits, measureCount: 8, expectedDraftRevision: originalRevision,
    })).rejects.toMatchObject({ code: 'draft-changed', draftRevision: draftRevision(savedByOtherTab) });

    expect(atomicWrites).toHaveBeenCalledTimes(writeCount);
    expect(datastore.getSheetMusicLearn(SCORE_A)).toEqual(savedBeforeConflict);
  });

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

    const draft = await service.saveDraft(SCORE_A, { segments: SEGMENTS_A, measureCount: 8, expectedDraftRevision: null });
    await service.approve(SCORE_A, { measureCount: 8, expectedDraftRevision: draftRevision(SEGMENTS_A) });
    const approvedBefore = structuredClone(datastore.getSheetMusicLearn(SCORE_A));
    expect(approvedBefore).toMatchObject({ scoreId: SCORE_A, segments: SEGMENTS_A });
    const writeCount = atomicWrites.mock.calls.length;

    await expect(service.getLearn(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.draftImpact(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.saveDraft(SCORE_B, { segments: [{ id: 'b', start: 0, end: 3 }], measureCount: 8, expectedDraftRevision: null }))
      .rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.approve(SCORE_B, { measureCount: 8, expectedDraftRevision: draftRevision(SEGMENTS_A) }))
      .rejects.toMatchObject({ code: 'learn-record-conflict' });
    await expect(service.revert(SCORE_B)).rejects.toMatchObject({ code: 'learn-record-conflict' });

    expect(atomicWrites).toHaveBeenCalledTimes(writeCount);
    expect(datastore.getSheetMusicLearn(SCORE_A)).toEqual(approvedBefore);
  });
});
