import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schoolApi } from './schoolApi.js';

beforeEach(() => vi.unstubAllGlobals());

describe('schoolApi', () => {
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
