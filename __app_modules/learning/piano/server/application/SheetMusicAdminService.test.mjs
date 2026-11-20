// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SheetMusicAdminService, cleanProposal, draftRevision } from './SheetMusicAdminService.mjs';
import { practiceKeyOfScore } from '../../portable/music/practiceKey.mjs';

const ID_A = 'files:docs/sheet-music/classical/fur-elise.musicxml';
const ID_B = 'files:docs/sheet-music/folk/old-tune.mxl';

const xmlOf = ({ work, movement, composer } = {}) => [
  '<?xml version="1.0"?><score-partwise>',
  work ? `<work><work-title>${work}</work-title></work>` : '',
  movement ? `<movement-title>${movement}</movement-title>` : '',
  composer ? `<identification><creator type="composer">${composer}</creator></identification>` : '',
  '</score-partwise>',
].join('');

class FakeReadError extends Error {
  constructor(code, scoreId) { super(`${code}: ${scoreId}`); this.name = 'ScoreReadError'; this.code = code; this.scoreId = scoreId; }
}

function fixture({ scores = {}, learn = {}, covers = {}, practice = {}, learners = ['learner1', 'learner2'], datastoreOverrides = {}, writePoster } = {}) {
  const reads = [];
  const posters = [];
  const saved = [];
  const logs = [];
  const signatures = new Map(Object.keys(scores).map((id) => [id, 'sig-1']));
  const learnFiles = new Map(Object.entries(learn));
  const datastore = {
    getSheetMusicLearn: (id) => (learnFiles.has(id) ? structuredClone(learnFiles.get(id)) : null),
    saveSheetMusicLearn: (id, data) => { saved.push({ id, data: structuredClone(data) }); learnFiles.set(id, structuredClone(data)); return true; },
    sheetMusicCover: (id) => covers[id] ?? null,
    getPractice: (userId, key) => practice[`${userId}/${key}`] ?? {},
    ...datastoreOverrides,
  };
  const scoreReader = {
    read: async (id) => {
      reads.push(id);
      const s = scores[id];
      if (!s || s.error) throw new FakeReadError(s?.error || 'SCORE_NOT_FOUND', id);
      return { xml: s.xml, contentSha256: s.sha };
    },
  };
  const logger = {
    debug: (event, data) => logs.push({ level: 'debug', event, data }),
    info: (event, data) => logs.push({ level: 'info', event, data }),
    warn: (event, data) => logs.push({ level: 'warn', event, data }),
    error: (event, data) => logs.push({ level: 'error', event, data }),
  };
  const service = new SheetMusicAdminService({
    datastore,
    scoreReader,
    listScores: () => Object.keys(scores).map((id) => {
      const parts = id.split('/');
      return { id, folder: parts[parts.length - 2], file: parts[parts.length - 1] };
    }),
    listLearners: () => learners,
    fileSignature: (id) => signatures.get(id) ?? null,
    clock: () => new Date('2026-11-20T10:00:00.000Z'),
    logger,
    writePoster: writePoster ?? (async (id, text) => {
      posters.push({ id, text });
      return `${id.replace(/^files:/, '').replace(/\.[^.]+$/, '')}.svg`;
    }),
  });
  return { service, reads, saved, logs, signatures, learnFiles, posters };
}

const seg = (id, start, end, extra = {}) => ({ id, start, end, ...extra });

describe('SheetMusicAdminService.library', () => {
  it('reports each of the five learn states', async () => {
    const ids = ['none', 'draft', 'approved', 'both', 'stale'].map((s) => `files:docs/sheet-music/test/${s}.musicxml`);
    const scores = Object.fromEntries(ids.map((id) => [id, { xml: xmlOf({ work: 'X' }), sha: 'sha-now' }]));
    const approved = { scoreId: ids[2], contentSha256: 'sha-now', segments: [seg('a', 0, 3)], approved: { at: '2026-11-01T00:00:00Z' } };
    const { service } = fixture({
      scores,
      learn: {
        [ids[1]]: { scoreId: ids[1], draft: { segments: [seg('a', 0, 3)] } },
        [ids[2]]: approved,
        [ids[3]]: { ...approved, scoreId: ids[3], draft: { segments: [seg('a', 0, 4)] } },
        [ids[4]]: { ...approved, scoreId: ids[4], contentSha256: 'sha-old' },
      },
    });
    const rows = await service.library();
    expect(rows.map((r) => r.learn)).toEqual(['none', 'draft', 'approved', 'approved+draft', 'stale']);
  });

  it('reads title and composer from the XML, decodes entities, and falls back to the file name', async () => {
    const idC = 'files:docs/sheet-music/folk/the_old-mill.musicxml';
    const { service } = fixture({
      scores: {
        [ID_A]: { xml: xmlOf({ work: 'F&#252;r Elise &amp; Co', movement: 'ignored', composer: 'Ludwig van Beethoven' }), sha: 's1' },
        [ID_B]: { xml: xmlOf({ movement: 'Old &lt;Tune&gt;' }), sha: 's2' },
        [idC]: { xml: xmlOf({}), sha: 's3' },
      },
    });
    const rows = await service.library();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[ID_A]).toMatchObject({ title: 'Für Elise & Co', composer: 'Ludwig van Beethoven', format: 'musicxml', folder: 'classical', file: 'fur-elise.musicxml' });
    expect(byId[ID_B]).toMatchObject({ title: 'Old <Tune>', composer: null, format: 'mxl' });
    expect(byId[idC]).toMatchObject({ title: 'The Old Mill', composer: null });
  });

  it('maps the cover to scan, generated or none', async () => {
    const idC = 'files:docs/sheet-music/folk/c.musicxml';
    const { service } = fixture({
      scores: { [ID_A]: { xml: xmlOf(), sha: '1' }, [ID_B]: { xml: xmlOf(), sha: '2' }, [idC]: { xml: xmlOf(), sha: '3' } },
      covers: { [ID_A]: '/api/v1/proxy/media/stream/docs%2Fsheet-music%2Fclassical%2Ffur-elise.jpg', [ID_B]: '/api/v1/proxy/media/stream/docs%2Fsheet-music%2Ffolk%2Fold-tune.svg' },
    });
    const rows = await service.library();
    expect(Object.fromEntries(rows.map((r) => [r.id, r.poster]))).toEqual({ [ID_A]: 'scan', [ID_B]: 'generated', [idC]: 'none' });
  });

  it('counts passages with progress per learner and omits learners with none', async () => {
    const key = practiceKeyOfScore(ID_A);
    const { service } = fixture({
      scores: { [ID_A]: { xml: xmlOf(), sha: '1' } },
      practice: {
        [`learner1/${key}`]: { learnCoach: { scoreId: ID_A, summary: { passages: [
          { id: 'p1', start: 0, end: 3, silver: true, gold: false },
          { id: 'p2', start: 4, end: 7, silver: true, gold: true },
          { id: 'p3', start: 8, end: 9, silver: false, gold: false },
        ] } } },
        [`learner2/${key}`]: { learnCoach: { scoreId: ID_A, summary: { passages: [{ id: 'p1', start: 0, end: 3 }] } } },
      },
    });
    const [row] = await service.library();
    expect(row.learners).toEqual([{ userId: 'learner1', passagesWithProgress: 2 }]);
  });

  it('keeps going past an unreadable score and reports the stored learn state', async () => {
    const { service, logs } = fixture({
      scores: { [ID_A]: { error: 'SCORE_UNREADABLE' }, [ID_B]: { xml: xmlOf({ work: 'B' }), sha: 's2' } },
      learn: { [ID_A]: { scoreId: ID_A, contentSha256: 'whatever', segments: [seg('a', 0, 1)] } },
    });
    const rows = await service.library();
    expect(rows[0]).toMatchObject({ id: ID_A, error: 'SCORE_UNREADABLE', learn: 'approved', title: 'Fur Elise', composer: null });
    expect(rows[1]).toMatchObject({ id: ID_B, title: 'B', learn: 'none' });
    expect(rows[1].error).toBeUndefined();
    expect(logs.find((l) => l.event === 'piano.sheetmusic.row-unreadable')).toMatchObject({ level: 'warn', data: { id: ID_A, code: 'SCORE_UNREADABLE' } });
  });

  it('reuses the cached read while the file signature holds and re-reads when it changes', async () => {
    const { service, reads, signatures } = fixture({ scores: { [ID_A]: { xml: xmlOf({ work: 'A' }), sha: '1' } } });
    await service.library();
    await service.library();
    expect(reads).toEqual([ID_A]);
    signatures.set(ID_A, 'sig-2');
    await service.library();
    expect(reads).toEqual([ID_A, ID_A]);
  });

  it('does not cache when the file has no signature', async () => {
    const { service, reads, signatures } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    signatures.delete(ID_A);
    await service.library();
    await service.library();
    expect(reads).toEqual([ID_A, ID_A]);
  });
});

describe('SheetMusicAdminService.getLearn', () => {
  it('returns the normalized file with the current sha and staleness', async () => {
    const { service } = fixture({
      scores: { [ID_A]: { xml: xmlOf(), sha: 'sha-now' } },
      learn: { [ID_A]: { scoreId: ID_A, contentSha256: 'sha-old', segments: [seg('a', 0, 3)] } },
    });
    const learn = await service.getLearn(ID_A);
    expect(learn).toMatchObject({ version: 1, scoreId: ID_A, segments: [seg('a', 0, 3)], draft: null, currentSha256: 'sha-now', stale: true });
  });

  it('is not stale when nothing is approved', async () => {
    const { service } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: 'sha-now' } } });
    expect(await service.getLearn(ID_A)).toMatchObject({ scoreId: ID_A, segments: [], stale: false, currentSha256: 'sha-now' });
  });
});

describe('SheetMusicAdminService.saveDraft', () => {
  it('writes only the draft and keeps the approved segments', async () => {
    const approved = { version: 1, scoreId: ID_A, contentSha256: 'sha-1', segments: [seg('a', 0, 3)], approved: { at: '2026-11-01T00:00:00Z' } };
    const { service, saved, logs } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: 'sha-1' } }, learn: { [ID_A]: approved } });
    const segments = [seg('a', 0, 1, { parts: ['rh'] }), seg('b', 2, 5, { name: 'Bridge' })];
    const file = await service.saveDraft(ID_A, { segments, proposal: { scorer: 'manual', at: 't' }, measureCount: 6 });
    expect(saved).toHaveLength(1);
    expect(saved[0].data).toMatchObject({ contentSha256: 'sha-1', segments: [seg('a', 0, 3)], approved: approved.approved });
    expect(saved[0].data.draft).toEqual({ segments, proposal: { scorer: 'manual', at: 't' } });
    expect(file.draft.segments).toEqual(segments);
    expect(file.segments).toEqual([seg('a', 0, 3)]);
    expect(logs.find((l) => l.event === 'piano.sheetmusic.learn-saved')).toMatchObject({ level: 'info', data: { id: ID_A, status: 'draft', segments: 2 } });
  });

  it('sets scoreId on a new file', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    await service.saveDraft(ID_A, { segments: [seg('a', 0, 1)], measureCount: 2 });
    expect(saved[0].data).toMatchObject({ version: 1, scoreId: ID_A, draft: { segments: [seg('a', 0, 1)] } });
    expect(saved[0].data.segments).toBeUndefined();
  });

  it('keeps only known proposal keys, and features no longer than the score', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    const proposal = {
      scorer: 'heuristic', model: null, at: 't', edited: true, beatsPerMeasure: 3, failedCalls: 0,
      boundaries: { 0: 0.2, 1: 0.9, 7: 0.5, x: 1, 2: 'no' },
      featureKeys: ['after', 'tailGapRatio'],
      features: [[0, 0.25], [1, 1], [2, null], [3, 0.5], [4, 0.1]],
      source: 'kiosk', html: '<b>',
    };
    await service.saveDraft(ID_A, { segments: [seg('a', 0, 1), seg('b', 2, 3)], proposal, measureCount: 4 });
    expect(saved[0].data.draft.proposal).toEqual({
      scorer: 'heuristic', model: null, at: 't', edited: true, beatsPerMeasure: 3, failedCalls: 0,
      boundaries: { 0: 0.2, 1: 0.9 },
      featureKeys: ['after', 'tailGapRatio'],
      features: [[0, 0.25], [1, 1], [2, null]],
    });
  });

  it('drops a proposal with nothing known in it', () => {
    expect(cleanProposal({ source: 'kiosk' }, 4)).toBeNull();
    expect(cleanProposal('heuristic', 4)).toBeNull();
    expect(cleanProposal({ scorer: 'heuristic', features: [['x']] }, 4)).toEqual({ scorer: 'heuristic' });
  });

  it('keeps the score version a proposal was computed on', () => {
    expect(cleanProposal({ scorer: 'heuristic', contentSha256: 'abc' }, 4)).toEqual({ scorer: 'heuristic', contentSha256: 'abc' });
    expect(cleanProposal({ scorer: 'heuristic', contentSha256: 7 }, 4)).toEqual({ scorer: 'heuristic' });
  });

  it('feature rows are no longer than featureKeys, and exactly as long when keys are given', () => {
    const keys = ['after', 'gap'];
    expect(cleanProposal({ scorer: 'h', featureKeys: keys, features: [[0, 1], [1, 2]] }, 4).features).toEqual([[0, 1], [1, 2]]);
    expect(cleanProposal({ scorer: 'h', featureKeys: keys, features: [[0, 1], [1]] }, 4).features).toBeUndefined();
    expect(cleanProposal({ scorer: 'h', featureKeys: keys, features: [[0, 1, 9]] }, 4).features).toBeUndefined();
    // Without keys, rows still may not run past the longest known row (FEATURE_KEYS).
    expect(cleanProposal({ scorer: 'h', features: [Array.from({ length: 40 }, () => 1)] }, 4).features).toBeUndefined();
  });

  it('rejects invalid segments with the validation errors and writes nothing', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    const err = await service.saveDraft(ID_A, { segments: [seg('a', 0, 9)], measureCount: 4 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid-segments', errors: [{ code: 'out-of-range', id: 'a', index: 0 }] });
    expect(saved).toHaveLength(0);
  });
});

describe('SheetMusicAdminService.impact and approve', () => {
  const key = practiceKeyOfScore(ID_A);
  const practice = {
    [`learner1/${key}`]: { learnCoach: { scoreId: ID_A, summary: { total: 2, gold: 2, passages: [
      { id: 'p1', start: 0, end: 3, silver: true, gold: true },
      { id: 'p2', start: 4, end: 7, silver: true, gold: true },
    ] } } },
    // A record for a different score under the same key is ignored.
    [`learner2/${key}`]: { learnCoach: { scoreId: 'files:docs/sheet-music/other.musicxml', summary: { passages: [{ id: 'x', start: 0, end: 1, silver: true }] } } },
  };
  const draftSegments = [seg('a', 0, 3), seg('b', 4, 5), seg('c', 6, 7)];

  it('impact lists learners whose coach summary is for this score', async () => {
    const { service } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, practice });
    const impact = await service.impact(ID_A, draftSegments);
    expect(impact).toHaveLength(1);
    expect(impact[0]).toMatchObject({ userId: 'learner1', lostSilver: 1, lostGold: 1, wasAllGold: true, allGoldAfter: false });
    expect(impact[0].kept.map((p) => p.id)).toEqual(['p1']);
    expect(impact[0].orphaned.map((p) => p.id)).toEqual(['p2']);
  });

  it('approve moves the draft to segments, stamps sha and time, drops the draft and returns impact', async () => {
    const { service, saved, logs } = fixture({
      scores: { [ID_A]: { xml: xmlOf(), sha: 'sha-now' } },
      learn: { [ID_A]: { version: 1, scoreId: ID_A, contentSha256: 'sha-old', segments: [seg('p1', 0, 3), seg('p2', 4, 7)], draft: { segments: draftSegments, proposal: { by: 'kiosk' } } } },
      practice,
    });
    const { file, impact } = await service.approve(ID_A, { measureCount: 8, expectedDraftRevision: draftRevision(draftSegments) });
    expect(saved).toHaveLength(1);
    const written = saved[0].data;
    expect(written.segments).toEqual(draftSegments);
    expect(written.contentSha256).toBe('sha-now');
    expect(written.approved).toEqual({ at: '2026-11-20T10:00:00.000Z' });
    expect('draft' in written).toBe(false);
    expect(file).toMatchObject({ segments: draftSegments, draft: null, contentSha256: 'sha-now' });
    expect(impact).toHaveLength(1);
    expect(impact[0].kept.map((p) => p.id)).toEqual(['p1']);
    expect(impact[0].orphaned.map((p) => p.id)).toEqual(['p2']);
    expect(logs.find((l) => l.event === 'piano.sheetmusic.learn-saved')).toMatchObject({
      level: 'info', data: { id: ID_A, status: 'approved', segments: 3, orphaned: 1, learnersAffected: 1 },
    });
  });

  it('approve without a draft fails with no-draft', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, learn: { [ID_A]: { scoreId: ID_A, segments: [seg('a', 0, 1)] } } });
    await expect(service.approve(ID_A, { measureCount: 4, expectedDraftRevision: 'any' })).rejects.toMatchObject({ code: 'no-draft' });
    expect(saved).toHaveLength(0);
  });

  it('approve rejects a draft that does not fit the measure count', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, learn: { [ID_A]: { scoreId: ID_A, draft: { segments: draftSegments } } } });
    const err = await service.approve(ID_A, { measureCount: 6, expectedDraftRevision: draftRevision(draftSegments) }).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid-segments' });
    expect(err.errors.map((e) => e.id)).toEqual(['c']);
    expect(saved).toHaveLength(0);
  });

  it('approve propagates a score read failure without writing', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { error: 'SCORE_NOT_FOUND' } }, learn: { [ID_A]: { scoreId: ID_A, draft: { segments: draftSegments } } } });
    await expect(service.approve(ID_A, { measureCount: 8, expectedDraftRevision: draftRevision(draftSegments) })).rejects.toMatchObject({ code: 'SCORE_NOT_FOUND' });
    expect(saved).toHaveLength(0);
  });
});

describe('SheetMusicAdminService.revert', () => {
  it('clears the approved segments and keeps the draft', async () => {
    const draft = { segments: [seg('a', 0, 1)] };
    const { service, saved, logs } = fixture({
      scores: { [ID_A]: { xml: xmlOf(), sha: '1' } },
      learn: { [ID_A]: { version: 1, scoreId: ID_A, contentSha256: '1', segments: [seg('a', 0, 3)], approved: { at: 'x' }, draft } },
    });
    const { file, impact } = await service.revert(ID_A);
    expect(impact).toBeNull();
    const written = saved[0].data;
    expect(written.segments).toBeUndefined();
    expect(written.contentSha256).toBeUndefined();
    expect(written.approved).toBeUndefined();
    expect(written.draft).toEqual(draft);
    expect(file).toMatchObject({ segments: [], approved: null, draft });
    expect(logs.find((l) => l.event === 'piano.sheetmusic.learn-saved')).toMatchObject({ data: { id: ID_A, status: 'reverted' } });
  });
});

describe('review fixes: draft pinning, empty drafts, non-library ids, robust rows', () => {
  const key = practiceKeyOfScore(ID_A);
  const LONG_SHA = 'abcdef0123456789abcdef0123456789';
  const draftSegments = [seg('a', 0, 3), seg('b', 4, 7)];
  const practice = {
    [`learner1/${key}`]: { learnCoach: { scoreId: ID_A, summary: { passages: [
      { id: 'p1', start: 0, end: 3, silver: true }, { id: 'p2', start: 4, end: 5, gold: true },
    ] } } },
  };
  const withDraft = (extra = {}) => fixture({
    scores: { [ID_A]: { xml: xmlOf(), sha: LONG_SHA } },
    learn: { [ID_A]: { scoreId: ID_A, draft: { segments: draftSegments } } },
    practice,
    ...extra,
  });

  it('getLearn and saveDraft return the draftRevision; null without a draft', async () => {
    const { service } = withDraft();
    expect((await service.getLearn(ID_A)).draftRevision).toBe(draftRevision(draftSegments));
    const other = [seg('x', 0, 1)];
    const saved = await service.saveDraft(ID_A, { segments: other, measureCount: 8 });
    expect(saved.draftRevision).toBe(draftRevision(other));
    expect(saved.draftRevision).not.toBe(draftRevision(draftSegments));
    const { service: bare } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    expect((await bare.getLearn(ID_A)).draftRevision).toBeNull();
  });

  it('draftImpact gives the impact of the stored draft and its revision', async () => {
    const { service } = withDraft();
    const { draftRevision: rev, impact } = await service.draftImpact(ID_A);
    expect(rev).toBe(draftRevision(draftSegments));
    expect(impact).toHaveLength(1);
    expect(impact[0].kept.map((p) => p.id)).toEqual(['p1']);
    expect(impact[0].orphaned.map((p) => p.id)).toEqual(['p2']);
  });

  it('draftImpact without a draft fails with no-draft', async () => {
    const { service } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } } });
    await expect(service.draftImpact(ID_A)).rejects.toMatchObject({ code: 'no-draft' });
  });

  it('approve requires expectedDraftRevision', async () => {
    const { service, saved } = withDraft();
    await expect(service.approve(ID_A, { measureCount: 8 })).rejects.toMatchObject({ code: 'invalid-request' });
    expect(saved).toHaveLength(0);
  });

  it('approve refuses when the draft changed since it was reviewed', async () => {
    const { service, saved } = withDraft();
    const reviewed = (await service.draftImpact(ID_A)).draftRevision;
    await service.saveDraft(ID_A, { segments: [seg('a', 0, 7)], measureCount: 8 });
    saved.length = 0;
    await expect(service.approve(ID_A, { measureCount: 8, expectedDraftRevision: reviewed })).rejects.toMatchObject({ code: 'draft-changed' });
    expect(saved).toHaveLength(0);
  });

  it('approve reads the score even when the cache is warm, and logs a 12-char sha prefix', async () => {
    const { service, reads, logs } = withDraft();
    await service.library();
    expect(reads).toEqual([ID_A]);
    await service.approve(ID_A, { measureCount: 8, expectedDraftRevision: draftRevision(draftSegments) });
    expect(reads).toEqual([ID_A, ID_A]);
    const log = logs.find((l) => l.event === 'piano.sheetmusic.learn-saved' && l.data.status === 'approved');
    expect(log.data.contentSha256).toBe(LONG_SHA.slice(0, 12));
  });

  it('saveDraft rejects an empty segment list', async () => {
    const { service, saved } = withDraft();
    await expect(service.saveDraft(ID_A, { segments: [], measureCount: 8 }))
      .rejects.toMatchObject({ code: 'invalid-segments', errors: [{ code: 'empty', id: null, index: -1 }] });
    expect(saved).toHaveLength(0);
  });

  it('approve rejects an empty draft', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, learn: { [ID_A]: { scoreId: ID_A, draft: { segments: [] } } } });
    await expect(service.approve(ID_A, { measureCount: 8, expectedDraftRevision: draftRevision([]) }))
      .rejects.toMatchObject({ code: 'invalid-segments', errors: [{ code: 'empty', id: null, index: -1 }] });
    expect(saved).toHaveLength(0);
  });

  it('saveDraft without measureCount fails with bad-measure-count', async () => {
    const { service } = withDraft();
    await expect(service.saveDraft(ID_A, { segments: draftSegments }))
      .rejects.toMatchObject({ code: 'invalid-segments', errors: [{ code: 'bad-measure-count', id: null, index: -1 }] });
  });

  it('refuses non-library ids on every Learn method', async () => {
    const { service, saved, reads } = withDraft();
    const bad = 'files:docs/other/x.musicxml';
    await expect(service.getLearn(bad)).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    await expect(service.saveDraft(bad, { segments: draftSegments, measureCount: 8 })).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    await expect(service.approve(bad, { measureCount: 8, expectedDraftRevision: 'x' })).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    await expect(service.revert(bad)).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    await expect(service.impact(bad, draftSegments)).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    await expect(service.draftImpact(bad)).rejects.toMatchObject({ code: 'NOT_LIBRARY_SCORE' });
    expect(saved).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  it('saveDraft for a missing score fails with SCORE_NOT_FOUND and writes nothing', async () => {
    const missing = 'files:docs/sheet-music/folk/gone.musicxml';
    const { service, saved } = fixture({ scores: {} });
    await expect(service.saveDraft(missing, { segments: [seg('a', 0, 1)], measureCount: 4 })).rejects.toMatchObject({ code: 'SCORE_NOT_FOUND' });
    expect(saved).toHaveLength(0);
  });

  it('revert with nothing approved writes nothing and reports changed: false', async () => {
    const { service, saved, logs } = withDraft();
    const result = await service.revert(ID_A);
    expect(result).toMatchObject({ impact: null, changed: false, file: { segments: [], draft: { segments: draftSegments } } });
    expect(saved).toHaveLength(0);
    expect(logs.filter((l) => l.event === 'piano.sheetmusic.learn-saved')).toHaveLength(0);
  });

  it('revert of an approved file reports changed: true', async () => {
    const { service } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, learn: { [ID_A]: { scoreId: ID_A, contentSha256: '1', segments: [seg('a', 0, 1)], approved: { at: 'x' } } } });
    expect((await service.revert(ID_A)).changed).toBe(true);
  });

  it('unwraps CDATA in titles and composers', async () => {
    const { service } = fixture({ scores: { [ID_A]: { xml: xmlOf({ work: '<![CDATA[Für <Elise> & Co]]>', composer: '<![CDATA[L. v. B.]]>' }), sha: '1' } } });
    const [row] = await service.library();
    expect(row).toMatchObject({ title: 'Für <Elise> & Co', composer: 'L. v. B.' });
  });

  it('a throwing Learn file, cover or practice read marks that row only', async () => {
    const idC = 'files:docs/sheet-music/folk/c.musicxml';
    const scores = { [ID_A]: { xml: xmlOf(), sha: '1' }, [ID_B]: { xml: xmlOf(), sha: '2' }, [idC]: { xml: xmlOf({ work: 'C' }), sha: '3' } };
    const boom = () => { throw new Error('bad yaml'); };
    const { service } = fixture({
      scores,
      datastoreOverrides: {
        getSheetMusicLearn: (id) => (id === ID_A ? boom() : null),
        sheetMusicCover: (id) => (id === ID_B ? boom() : null),
        getPractice: (userId, k) => (k === practiceKeyOfScore(idC) && userId === 'learner1' ? boom() : {}),
      },
    });
    const rows = await service.library();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[ID_A]).toMatchObject({ error: 'LEARN_UNREADABLE', learn: null });
    expect(byId[ID_B]).toMatchObject({ error: 'COVER_UNREADABLE', poster: 'none', learn: 'none' });
    expect(byId[idC]).toMatchObject({ error: 'PRACTICE_UNREADABLE', title: 'C', learners: [] });
  });
});

describe('SheetMusicAdminService.upload', () => {
  const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
  const scoreXml = ({ title = 'Für Élise', composer = 'Ludwig van Beethoven', body = NOTE, root = 'score-partwise' } = {}) => [
    `<?xml version="1.0" encoding="UTF-8"?><${root} version="4.0">`,
    title ? `<work><work-title>${title}</work-title></work>` : '',
    composer ? `<identification><creator type="composer">${composer}</creator></identification>` : '',
    `<part-list/><part id="P1"><measure number="1">${body}</measure></part></${root}>`,
  ].join('');
  const bytes = (text) => Buffer.from(text, 'utf8');
  const MXL_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

  function uploadFixture({ existing = [], refs = ['files:docs/sheet-music/classical', 'files:docs/sheet-music/folk'],
    extractMxl = async () => scoreXml({ title: 'Old Tune', composer: null }), writeError = null } = {}) {
    const writes = [];
    const logs = [];
    const logger = {
      info: (event, data) => logs.push({ level: 'info', event, data }),
      warn: (event, data) => logs.push({ level: 'warn', event, data }),
      error: (event, data) => logs.push({ level: 'error', event, data }),
    };
    const extractCalls = [];
    const service = new SheetMusicAdminService({
      datastore: {},
      scoreReader: {},
      listScores: async () => existing.map((id) => ({ id, folder: id.split('/').at(-2), file: id.split('/').at(-1) })),
      listLearners: () => [],
      logger,
      extractMxl: async (buffer) => { extractCalls.push(buffer); return extractMxl(buffer); },
      writeScoreExclusive: async (id, buffer) => {
        if (writeError) throw writeError;
        writes.push({ id, buffer });
      },
      collectionRefs: () => refs,
    });
    return { service, writes, logs, extractCalls };
  }

  async function expectRejected(promise, code, logs) {
    const error = await promise.then(() => null, (e) => e);
    expect(error, `should reject with ${code}`).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    const rejected = logs.filter((l) => l.event === 'piano.sheetmusic.upload-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ level: 'warn', data: { code } });
    return error;
  }

  it('writes the original bytes under a suggested name and logs the upload', async () => {
    const { service, writes, logs } = uploadFixture();
    const buffer = bytes(scoreXml());
    const result = await service.upload({ buffer, originalName: 'Score.MusicXML', folder: 'classical' });
    const id = 'files:docs/sheet-music/classical/fur-elise-ludwig-van-beethoven.musicxml';
    expect(result).toEqual({ id, title: 'Für Élise', composer: 'Ludwig van Beethoven', filename: 'fur-elise-ludwig-van-beethoven.musicxml' });
    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe(id);
    expect(writes[0].buffer).toBe(buffer);
    expect(logs).toEqual([{ level: 'info', event: 'piano.sheetmusic.upload', data: { id, bytes: buffer.byteLength, folder: 'classical' } }]);
  });

  it('uses a given filename', async () => {
    const { service, writes } = uploadFixture();
    const result = await service.upload({ buffer: bytes(scoreXml()), originalName: 'x.musicxml', folder: 'folk', filename: 'elise.musicxml' });
    expect(result.id).toBe('files:docs/sheet-music/folk/elise.musicxml');
    expect(writes[0].id).toBe(result.id);
  });

  it('suggests from the original name when the header has no title', async () => {
    const { service } = uploadFixture();
    const result = await service.upload({ buffer: bytes(scoreXml({ title: null, composer: null })), originalName: 'My Song.musicxml', folder: 'folk' });
    expect(result).toMatchObject({ filename: 'my-song.musicxml', title: 'My Song', composer: null });
  });

  it('reads an .mxl through extractMxl but stores the archive bytes', async () => {
    const { service, writes, extractCalls } = uploadFixture();
    const result = await service.upload({ buffer: MXL_BYTES, originalName: 'tune.mxl', folder: 'folk' });
    expect(extractCalls).toEqual([MXL_BYTES]);
    expect(result).toMatchObject({ id: 'files:docs/sheet-music/folk/old-tune.mxl', title: 'Old Tune', composer: null });
    expect(writes[0].buffer).toBe(MXL_BYTES);
  });

  it('refuses a request without bytes: invalid-request', async () => {
    const { service, logs } = uploadFixture();
    await expectRejected(service.upload({ buffer: 'text', originalName: 'a.musicxml', folder: 'folk' }), 'invalid-request', logs);
  });

  it('refuses other extensions: bad-extension', async () => {
    const { service, logs, writes } = uploadFixture();
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.xml', folder: 'folk' }), 'bad-extension', logs);
    expect(writes).toEqual([]);
  });

  it('refuses oversize files: SCORE_TOO_LARGE', async () => {
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    const a = uploadFixture();
    await expectRejected(a.service.upload({ buffer: big, originalName: 'a.mxl', folder: 'folk' }), 'SCORE_TOO_LARGE', a.logs);
    expect(a.extractCalls).toEqual([]);
    const b = uploadFixture();
    await expectRejected(b.service.upload({ buffer: new Uint8Array(32 * 1024 * 1024 + 1), originalName: 'a.musicxml', folder: 'folk' }),
      'SCORE_TOO_LARGE', b.logs);
  });

  it('maps an archive that decompresses too large to SCORE_TOO_LARGE', async () => {
    const { service, logs } = uploadFixture({ extractMxl: async () => { throw Object.assign(new Error('big'), { code: 'MXL_TOO_LARGE' }); } });
    await expectRejected(service.upload({ buffer: MXL_BYTES, originalName: 'a.mxl', folder: 'folk' }), 'SCORE_TOO_LARGE', logs);
  });

  it('refuses an unreadable archive: bad-mxl', async () => {
    const { service, logs } = uploadFixture({ extractMxl: async () => { throw new Error('bad zip'); } });
    await expectRejected(service.upload({ buffer: MXL_BYTES, originalName: 'a.mxl', folder: 'folk' }), 'bad-mxl', logs);
  });

  it.each([
    ['not-xml', 'just text'],
    ['timewise', scoreXml({ root: 'score-timewise' })],
    ['not-partwise', '<?xml version="1.0"?><opus><title>x</title></opus>'],
    ['no-notes', scoreXml({ body: '<note><rest/><duration>4</duration></note>' })],
  ])('refuses content: %s', async (code, xml) => {
    const { service, logs, writes } = uploadFixture();
    await expectRejected(service.upload({ buffer: bytes(xml), originalName: 'a.musicxml', folder: 'folk' }), code, logs);
    expect(writes).toEqual([]);
  });

  it.each(['studies', '../classical', 'classical/nested', '', undefined])('refuses folder %j: bad-folder', async (folder) => {
    const { service, logs } = uploadFixture();
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder }), 'bad-folder', logs);
  });

  it('accepts a folder named by the legacy single collection ref', async () => {
    const { service } = uploadFixture({ refs: ['files:docs/sheet-music/beginner'] });
    const result = await service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'beginner' });
    expect(result.id).toMatch(/^files:docs\/sheet-music\/beginner\//);
  });

  it.each(['Bad Name.musicxml', 'a.xml', 'elise.mxl'])('refuses filename %j: bad-filename', async (filename) => {
    const { service, logs } = uploadFixture();
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'folk', filename }), 'bad-filename', logs);
  });

  it('refuses the same stem in the folder in the other format: basename-exists', async () => {
    const { service, logs, writes } = uploadFixture({ existing: ['files:docs/sheet-music/classical/fur-elise-ludwig-van-beethoven.mxl'] });
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'classical' }), 'basename-exists', logs);
    expect(writes).toEqual([]);
  });

  it('refuses a practice-key collision across folders: slug-collides', async () => {
    const { service, logs } = uploadFixture({ existing: ['files:docs/sheet-music/folk-old/tune.mxl'] });
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.mxl', folder: 'folk', filename: 'old-tune.mxl' }),
      'slug-collides', logs);
  });

  it('refuses a name whose practice key reaches 120 characters: slug-too-long', async () => {
    const { service, logs } = uploadFixture();
    const filename = `${'a'.repeat(100)}.musicxml`;
    expect(practiceKeyOfScore(`files:docs/sheet-music/folk/${filename}`).length).toBe(120);
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'folk', filename }), 'slug-too-long', logs);
  });

  it('maps a lost race on the write (EEXIST) to basename-exists', async () => {
    const { service, logs } = uploadFixture({ writeError: Object.assign(new Error('exists'), { code: 'EEXIST' }) });
    await expectRejected(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'folk' }), 'basename-exists', logs);
  });

  it('rethrows other write failures after logging them', async () => {
    const failure = Object.assign(new Error('disk'), { code: 'EACCES' });
    const { service, logs } = uploadFixture({ writeError: failure });
    const error = await service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'folk' }).then(() => null, (e) => e);
    expect(error).toBe(failure);
    expect(logs.map((l) => l.event)).toEqual(['piano.sheetmusic.upload-failed']);
  });

  it('requires its upload dependencies', async () => {
    const service = new SheetMusicAdminService({ datastore: {}, scoreReader: {}, listScores: () => [], listLearners: () => [] });
    await expect(service.upload({ buffer: bytes(scoreXml()), originalName: 'a.musicxml', folder: 'folk' })).rejects.toThrow(/requires extractMxl/);
  });
});

describe('SheetMusicAdminService.upload ordering and logs', () => {
  const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
  const plainXml = `<?xml version="1.0"?><score-partwise><part-list/><part id="P1"><measure>${NOTE}</measure></part></score-partwise>`;

  function make({ refs = ['files:docs/sheet-music/folk'], writeError = null } = {}) {
    const logs = [];
    const extractCalls = [];
    const writes = [];
    const logger = {
      info: (event, data) => logs.push({ level: 'info', event, data }),
      warn: (event, data) => logs.push({ level: 'warn', event, data }),
      error: (event, data) => logs.push({ level: 'error', event, data }),
    };
    const service = new SheetMusicAdminService({
      datastore: {},
      scoreReader: {},
      listScores: async () => [],
      listLearners: () => [],
      logger,
      extractMxl: async (buffer) => { extractCalls.push(buffer); return plainXml; },
      writeScoreExclusive: async (id, buffer) => { if (writeError) throw writeError; writes.push({ id, buffer }); },
      collectionRefs: () => refs,
    });
    return { service, logs, extractCalls, writes };
  }
  const reject = (promise) => promise.then(() => null, (e) => e);

  it('refuses a bad folder before extracting the archive', async () => {
    const { service, extractCalls } = make();
    const error = await reject(service.upload({ buffer: Buffer.from('PK'), originalName: 'a.mxl', folder: 'nope' }));
    expect(error.code).toBe('bad-folder');
    expect(extractCalls).toEqual([]);
  });

  it('refuses a bad filename before extracting the archive', async () => {
    const { service, extractCalls } = make();
    const error = await reject(service.upload({ buffer: Buffer.from('PK'), originalName: 'a.mxl', folder: 'folk', filename: 'a.musicxml' }));
    expect(error.code).toBe('bad-filename');
    expect(extractCalls).toEqual([]);
  });

  it('refuses a bad folder before reading bad XML', async () => {
    const { service } = make();
    const error = await reject(service.upload({ buffer: Buffer.from('not xml'), originalName: 'a.musicxml', folder: '../x' }));
    expect(error.code).toBe('bad-folder');
  });

  it('turns an original name with path separators into a safe suggested name', async () => {
    const { service, writes } = make();
    const result = await service.upload({ buffer: Buffer.from(plainXml), originalName: '../../evil/Für.musicxml', folder: 'folk' });
    expect(result.filename).toBe('fur.musicxml');
    expect(result.id).toBe('files:docs/sheet-music/folk/fur.musicxml');
    expect(writes[0].id).toBe(result.id);
    const windows = await service.upload({ buffer: Buffer.from(plainXml), originalName: '..\\..\\evil\\Old Song.musicxml', folder: 'folk' });
    expect(windows.filename).toBe('old-song.musicxml');
  });

  it('truncates request values in the rejection log', async () => {
    const { service, logs } = make();
    await reject(service.upload({ buffer: Buffer.from('x'), originalName: `${'n'.repeat(500)}.xml`, folder: 'f'.repeat(500) }));
    await reject(service.upload({ buffer: Buffer.from('x'), originalName: 'a.musicxml', folder: { nested: true } }));
    const rejected = logs.filter((l) => l.event === 'piano.sheetmusic.upload-rejected').map((l) => l.data);
    expect(rejected[0].originalName).toHaveLength(120);
    expect(rejected[0].folder).toHaveLength(120);
    expect(rejected[1]).toMatchObject({ code: 'bad-folder', folder: 'object', originalName: 'a.musicxml' });
  });

  it('logs codes, not messages, when the write fails', async () => {
    const failure = Object.assign(new Error('/secret/abs/path failed'), { code: 'SCORE_UNWRITABLE', cause: { code: 'EACCES' } });
    const { service, logs } = make({ writeError: failure });
    expect(await reject(service.upload({ buffer: Buffer.from(plainXml), originalName: 'a.musicxml', folder: 'folk' }))).toBe(failure);
    const failed = logs.find((l) => l.event === 'piano.sheetmusic.upload-failed');
    expect(failed.data).toEqual({ id: 'files:docs/sheet-music/folk/a.musicxml', code: 'SCORE_UNWRITABLE', causeCode: 'EACCES' });
    expect(JSON.stringify(failed.data)).not.toContain('/secret');
  });
});

describe('SheetMusicAdminService.uploadFolders', () => {
  const base = { datastore: {}, scoreReader: {}, listScores: () => [], listLearners: () => [] };

  it('lists the configured upload folders, re-reading the refs each call', async () => {
    let refs = ['files:docs/sheet-music/classical', 'plex:1'];
    const service = new SheetMusicAdminService({ ...base, collectionRefs: async () => refs });
    expect(await service.uploadFolders()).toEqual(['classical']);
    refs = ['files:docs/sheet-music/folk'];
    expect(await service.uploadFolders()).toEqual(['folk']);
  });

  it('is empty when no refs reader is wired', async () => {
    expect(await new SheetMusicAdminService(base).uploadFolders()).toEqual([]);
  });
});

describe('SheetMusicAdminService.savePoster', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" data-daylight-poster="generated"><path d="M0 0L1 1"/></svg>';
  const scores = { [ID_A]: { xml: xmlOf({ work: 'Für Elise' }), sha: 'sha-now' } };
  const stream = (local) => `/api/v1/proxy/media/stream/${encodeURIComponent(local)}`;
  const codeOf = (promise) => promise.then(() => null, (e) => e?.code);

  it('checks the svg, writes it beside the score and logs poster-saved', async () => {
    const { service, posters, logs } = fixture({ scores });
    const result = await service.savePoster(ID_A, SVG);
    expect(posters).toEqual([{ id: ID_A, text: SVG }]);
    expect(result).toEqual({
      id: ID_A, poster: 'generated', url: stream('docs/sheet-music/classical/fur-elise.svg'), bytes: SVG.length,
    });
    expect(logs).toContainEqual({ level: 'info', event: 'piano.sheetmusic.poster-saved', data: { id: ID_A, bytes: SVG.length, replaced: false } });
  });

  it('replaces an earlier generated poster', async () => {
    const { service, posters, logs } = fixture({ scores, covers: { [ID_A]: stream('docs/sheet-music/classical/fur-elise.svg') } });
    await service.savePoster(ID_A, SVG);
    expect(posters).toHaveLength(1);
    expect(logs.find((l) => l.event === 'piano.sheetmusic.poster-saved').data.replaced).toBe(true);
  });

  it('refuses unsafe svg with the checker code and logs poster-rejected', async () => {
    const { service, posters, logs } = fixture({ scores });
    expect(await codeOf(service.savePoster(ID_A, SVG.replace('<path', '<script/><path')))).toBe('script');
    expect(await codeOf(service.savePoster(ID_A, SVG.replace('<path', '<g onclick="x()"/><path')))).toBe('event-handler');
    expect(await codeOf(service.savePoster(ID_A, SVG.replace('<path', '<image href="#a"/><path')))).toBe('element');
    expect(await codeOf(service.savePoster(ID_A, `<svg xmlns="http://www.w3.org/2000/svg"><path d="${'M0 0'.repeat(80000)}"/></svg>`))).toBe('too-large');
    expect(await codeOf(service.savePoster(ID_A, 'not xml'))).toBe('not-svg');
    expect(posters).toEqual([]);
    const rejected = logs.filter((l) => l.event === 'piano.sheetmusic.poster-rejected').map((l) => l.data.code);
    expect(rejected).toEqual(['script', 'event-handler', 'element', 'too-large', 'not-svg']);
  });

  it('refuses when a raster scan exists', async () => {
    const { service, posters } = fixture({ scores, covers: { [ID_A]: stream('docs/sheet-music/classical/fur-elise.jpg') } });
    expect(await codeOf(service.savePoster(ID_A, SVG))).toBe('has-scan');
    expect(posters).toEqual([]);
  });

  it('refuses a missing score, a non-library id and a non-string body', async () => {
    const { service, posters } = fixture({ scores });
    expect(await codeOf(service.savePoster(ID_B, SVG))).toBe('SCORE_NOT_FOUND');
    expect(await codeOf(service.savePoster('files:docs/other/x.musicxml', SVG))).toBe('NOT_LIBRARY_SCORE');
    expect(await codeOf(service.savePoster(ID_A, undefined))).toBe('invalid-request');
    expect(posters).toEqual([]);
  });

  it('only takes scores: a library id that is not .musicxml/.mxl is invalid-request', async () => {
    const { service, posters } = fixture({ scores });
    expect(await codeOf(service.savePoster('files:docs/sheet-music/classical/notes.pdf', SVG))).toBe('invalid-request');
    expect(await codeOf(service.savePoster('files:docs/sheet-music/classical/fur-elise.svg', SVG))).toBe('invalid-request');
    expect(posters).toEqual([]);
  });

  it('a cover lookup that throws is logged and treated as no poster', async () => {
    const { service, posters, logs } = fixture({
      scores, datastoreOverrides: { sheetMusicCover: () => { throw new Error('EIO'); } },
    });
    await service.savePoster(ID_A, SVG);
    expect(posters).toHaveLength(1);
    expect(logs.some((l) => l.event === 'piano.sheetmusic.cover-unreadable')).toBe(true);
  });

  it('maps a hand-made poster at the path to poster-exists', async () => {
    const error = Object.assign(new Error('exists'), { code: 'POSTER_EXISTS' });
    const { service } = fixture({ scores, writePoster: async () => { throw error; } });
    expect(await codeOf(service.savePoster(ID_A, SVG))).toBe('poster-exists');
  });

  it('getLearn reports the poster kind', async () => {
    const { service } = fixture({ scores, covers: { [ID_A]: stream('docs/sheet-music/classical/fur-elise.png') } });
    expect((await service.getLearn(ID_A)).poster).toBe('scan');
    const { service: none } = fixture({ scores });
    expect((await none.getLearn(ID_A)).poster).toBe('none');
  });
});
