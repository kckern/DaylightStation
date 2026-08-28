import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schoolApi } from './schoolApi.js';

beforeEach(() => vi.unstubAllGlobals());

describe('schoolApi', () => {
  it('asks for the server-selected study day when no day is supplied', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ learners: [] }) }));
    await schoolApi.teacherDay();
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/school/teacher/day', expect.any(Object));
  });

  it('returns ok/status/data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'b' }]), { status: 200 })));
    expect(await schoolApi.banks()).toEqual({ ok: true, status: 200, data: [{ id: 'b' }] });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks', expect.any(Object));
  });
  it('passes audience and posts JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.banks('generic');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks?audience=generic', expect.any(Object));
    await schoolApi.answer('ses_1', { itemId: 'q1', given: 'x' });
    const [, opts] = fetch.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ itemId: 'q1', given: 'x' });
  });
  it('maps HTTP errors to ok:false with status, and network failure to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gone' }), { status: 410 })));
    expect(await schoolApi.answer('ses_x', { itemId: 'q', given: 'x' })).toMatchObject({ ok: false, status: 410 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await schoolApi.roster()).toEqual({ ok: false, status: 0, data: null });
  });
  it('never throws: a body that fails JSON.stringify resolves to status 0, not a rejection', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const circular = {};
    circular.self = circular;
    await expect(schoolApi.answer('ses_1', circular)).resolves.toEqual({ ok: false, status: 0, data: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('answer() always POSTs even when body is omitted', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await schoolApi.answer('ses_1');
    const [, opts] = fetchMock.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
  });

  it('materials() GETs the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sections: [], materials: [] }), { status: 200 })));
    expect(await schoolApi.materials()).toEqual({ ok: true, status: 200, data: { sections: [], materials: [] } });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials', expect.any(Object));
  });

  it('reads the shared authored Catalog and one hydrated lesson address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.learningCatalogs();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/school/catalogs', expect.any(Object));
    await schoolApi.learningLesson({
      catalogId: 'main', subjectId: 'math & money', courseId: 'rates',
      unitId: 'unit/one', lessonId: 'intro',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/catalogs/main/subjects/math%20%26%20money/courses/rates/units/unit%2Fone/lessons/intro',
      expect.any(Object),
    );
  });

  it('requests a learner-scoped calculator continuation code without treating it as a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.continuationCode({ learnerId: 'kid a', moduleCode: '012345' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/continuation-code?learnerId=kid%20a&moduleCode=012345',
      expect.any(Object),
    );
  });

  it('builds reusable progress scope/time/curriculum filter queries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.progress({
      learnerId: 'kid-a', periodId: 'fall', subjectIds: ['math'],
      excludeClassifications: ['elective'], groupBy: ['subject', 'month'], recentLimit: 5,
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/school/progress?learnerId=kid-a&periodId=fall&recentLimit=5&subject=math&excludeClassification=elective&groupBy=subject%2Cmonth',
      expect.any(Object),
    );
    await schoolApi.progressOptions();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/school/progress/options', expect.any(Object));
  });

  it('reads report cards, periods, and a learner\'s resolved review feedback (Task 9)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.reportCard({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026', expect.any(Object),
    );
    await schoolApi.periods();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/school/periods', expect.any(Object));
    await schoolApi.reviewLearner('kid1');
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/school/review/learner/kid1?limit=20', expect.any(Object));
    await schoolApi.reviewLearner('kid 1', { limit: 5 });
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/school/review/learner/kid%201?limit=5', expect.any(Object));
  });

  it('reads adult instructional insights and records a learner reflection through generic School routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.instructionalInsights({ scopeType: 'classroom', scopeId: 'math' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/progress/insights?scopeType=classroom&scopeId=math', expect.any(Object),
    );
    await schoolApi.recordReflection({ learnerId: 'kid-a', selfRegulation: { confidence: 2 } });
    const [url, options] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/progress/reflections');
    expect(options.method).toBe('POST');
  });

  it('maps shared remediation reads and learner-control actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.remediationSessions('kid a');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/remediation?learnerId=kid%20a', expect.any(Object),
    );
    await schoolApi.remediationSession('rem/1', 'kid-a', { after: 2, limit: 5 });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/remediation/rem%2F1?learnerId=kid-a&after=2&limit=5', expect.any(Object),
    );
    await schoolApi.remediationAction('rem-1', {
      learnerId: 'kid-a', action: 'skip', clientSequence: 1, lastServerSequence: 2, turnId: 'turn-2',
    });
    expect(fetch.mock.calls.at(-1)[1].method).toBe('POST');
  });

  it('materialUnits() GETs units, with and without a userId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.materialUnits('plex:1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials/plex%3A1/units', expect.any(Object));
    await schoolApi.materialUnits('plex:1', 'kid1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials/plex%3A1/units?userId=kid1', expect.any(Object));
  });

  it('surfaceProfile() GETs the profile for a screen id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.surfaceProfile('screen-kitchen');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/surfaces/profile?screen=screen-kitchen', expect.any(Object));
  });

  it('certification() GETs by address+surface, or by surface alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    await schoolApi.certification({ address: 'core/quant/rates/intro/unit-rate', surface: 'screen-kitchen' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/school/certification?address=core%2Fquant%2Frates%2Fintro%2Funit-rate&surface=screen-kitchen',
      expect.any(Object),
    );
  });

  it('unitProgress() PUTs the progress body', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await schoolApi.unitProgress('plex:1', 'plex:2', { userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 });
    const [url, opts] = fetchMock.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/materials/plex%3A1/units/plex%3A2/progress');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 });
  });
});

describe('teacher console wrappers', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))));

  it('teachers() hits /teachers', async () => {
    await schoolApi.teachers();
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teachers', expect.any(Object));
  });
  it('reportCardFrozen() carries learner and optional period', async () => {
    await schoolApi.reportCardFrozen({ learnerId: 'learner4' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/report-card/frozen?learnerId=learner4', expect.any(Object));
    await schoolApi.reportCardFrozen({ learnerId: 'learner4', periodId: '2026-fall' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/report-card/frozen?learnerId=learner4&periodId=2026-fall', expect.any(Object));
  });
  it('lifecycleReview() hits the pending queue', async () => {
    await schoolApi.lifecycleReview();
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/review', expect.any(Object));
  });
  it('learnerSessions() encodes the learner and forwards the window', async () => {
    await schoolApi.learnerSessions('learner4');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/learners/learner4/sessions', expect.any(Object));
    await schoolApi.learnerSessions('a b', { window: 'today' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/learners/a%20b/sessions?window=today', expect.any(Object));
  });
  it('assignments() hits the per-learner lifecycle read', async () => {
    await schoolApi.assignments('learner4');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/assignments/learner4', expect.any(Object));
  });
  it('curriculumUnits() lists the catalog', async () => {
    await schoolApi.curriculumUnits();
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/curriculum/units', expect.any(Object));
  });
});

// ── Media-lesson checkpoints (Task 11) ────────────────────────────────────────
// These four back a HARD gate, so the tests below assert the wire shape, not
// just "a request happened": a heartbeat that silently degrades to a GET, or a
// 410 the client swallowed, both look fine from the caller and both break the
// gate.
describe('media-lesson endpoints', () => {
  const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 }));

  it('lessonSession() GETs the snapshot and encodes the server-minted id', async () => {
    vi.stubGlobal('fetch', okFetch());
    await schoolApi.lessonSession('ses/med 1');
    const [url, opts] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/lesson/ses%2Fmed%201');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
  });

  it('lessonAnswer() POSTs checkpointId/itemId/given verbatim, falsy answers included', async () => {
    vi.stubGlobal('fetch', okFetch());
    await schoolApi.lessonAnswer('ses/1', { checkpointId: 'cp-312', itemId: 'ast3-q4', given: 0 });
    const [url, opts] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/lesson/ses%2F1/answer');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ checkpointId: 'cp-312', itemId: 'ast3-q4', given: 0 });
  });

  it('lessonAnswer() still POSTs when the body is omitted (never degrades to a GET)', async () => {
    vi.stubGlobal('fetch', okFetch());
    await schoolApi.lessonAnswer('ses1');
    expect(fetch.mock.calls.at(-1)[1].method).toBe('POST');
  });

  it('lessonPosition() POSTs {position}, and position 0 is a real heartbeat, not an omission', async () => {
    vi.stubGlobal('fetch', okFetch());
    await schoolApi.lessonPosition('ses/1', 312.5);
    let [url, opts] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/lesson/ses%2F1/position');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ position: 312.5 });
    // The first heartbeat of a lesson resumed at the very start is position 0.
    // `req()` turns an undefined body into a GET, so a dropped 0 would silently
    // send the heartbeat as a GET to a POST-only route.
    await schoolApi.lessonPosition('ses1', 0);
    [url, opts] = fetch.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ position: 0 });
  });

  it('lessonEnded() POSTs the media element\'s own ended, with no body of its own', async () => {
    vi.stubGlobal('fetch', okFetch());
    await schoolApi.lessonEnded('ses/1');
    const [url, opts] = fetch.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/lesson/ses%2F1/ended');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({});
  });

  it('passes 410 Gone through on every lesson method — the session is dead, and only the caller can decide what that means on screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'session_gone' }), { status: 410 },
    )));
    const calls = [
      schoolApi.lessonSession('ses1'),
      schoolApi.lessonAnswer('ses1', { checkpointId: 'cp-1', itemId: 'q1', given: 'a' }),
      schoolApi.lessonPosition('ses1', 12),
      schoolApi.lessonEnded('ses1'),
    ];
    for (const result of await Promise.all(calls)) {
      expect(result).toEqual({ ok: false, status: 410, data: { error: 'session_gone' } });
    }
  });

  it('a failed heartbeat resolves rather than rejecting — a 15s timer must not raise an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    await expect(schoolApi.lessonPosition('ses1', 42)).resolves.toEqual({ ok: false, status: 0, data: null });
  });
});
