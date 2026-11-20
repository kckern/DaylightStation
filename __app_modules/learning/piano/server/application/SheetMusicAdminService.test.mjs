// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SheetMusicAdminService } from './SheetMusicAdminService.mjs';
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

function fixture({ scores = {}, learn = {}, covers = {}, practice = {}, learners = ['learner1', 'learner2'] } = {}) {
  const reads = [];
  const saved = [];
  const logs = [];
  const signatures = new Map(Object.keys(scores).map((id) => [id, 'sig-1']));
  const learnFiles = new Map(Object.entries(learn));
  const datastore = {
    getSheetMusicLearn: (id) => (learnFiles.has(id) ? structuredClone(learnFiles.get(id)) : null),
    saveSheetMusicLearn: (id, data) => { saved.push({ id, data: structuredClone(data) }); learnFiles.set(id, structuredClone(data)); return true; },
    sheetMusicCover: (id) => covers[id] ?? null,
    getPractice: (userId, key) => practice[`${userId}/${key}`] ?? {},
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
  });
  return { service, reads, saved, logs, signatures, learnFiles };
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
    expect(logs.find((l) => l.event === 'piano.sheetmusic.score-unreadable')).toMatchObject({ level: 'warn', data: { id: ID_A, code: 'SCORE_UNREADABLE' } });
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
    const file = await service.saveDraft(ID_A, { segments, proposal: { source: 'kiosk' }, measureCount: 6 });
    expect(saved).toHaveLength(1);
    expect(saved[0].data).toMatchObject({ contentSha256: 'sha-1', segments: [seg('a', 0, 3)], approved: approved.approved });
    expect(saved[0].data.draft).toEqual({ segments, proposal: { source: 'kiosk' } });
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
    const { file, impact } = await service.approve(ID_A, { measureCount: 8 });
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
    await expect(service.approve(ID_A, { measureCount: 4 })).rejects.toMatchObject({ code: 'no-draft' });
    expect(saved).toHaveLength(0);
  });

  it('approve rejects a draft that does not fit the measure count', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { xml: xmlOf(), sha: '1' } }, learn: { [ID_A]: { scoreId: ID_A, draft: { segments: draftSegments } } } });
    const err = await service.approve(ID_A, { measureCount: 6 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid-segments' });
    expect(err.errors.map((e) => e.id)).toEqual(['c']);
    expect(saved).toHaveLength(0);
  });

  it('approve propagates a score read failure without writing', async () => {
    const { service, saved } = fixture({ scores: { [ID_A]: { error: 'SCORE_NOT_FOUND' } }, learn: { [ID_A]: { scoreId: ID_A, draft: { segments: draftSegments } } } });
    await expect(service.approve(ID_A, { measureCount: 8 })).rejects.toMatchObject({ code: 'SCORE_NOT_FOUND' });
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
