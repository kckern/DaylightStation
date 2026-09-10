/**
 * The ladder goes live for children tomorrow, and until now its network layer
 * was the one place that could not answer "what happened?": three bare
 * `catch {}` blocks turned a dropped WiFi, a 500 and a malformed body into the
 * same `{ok:false, status:0}` with no record anywhere. These tests hold the
 * line that a failure is always SAID, and that a run id ties a child's
 * browser events to the backend events they caused.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const emitted = [];

vi.mock('../../../../lib/logging/Logger.js', () => {
  const child = (context) => ({
    debug: (event, data) => emitted.push({ level: 'debug', event, data, context }),
    info: (event, data) => emitted.push({ level: 'info', event, data, context }),
    warn: (event, data) => emitted.push({ level: 'warn', event, data, context }),
    error: (event, data) => emitted.push({ level: 'error', event, data, context }),
  });
  return { default: () => ({ child }), __esModule: true };
});

const { default: languageLog } = await import('./languageLog.js');
const { languageApi } = await import('./languageApi.js');

const events = (level) => emitted.filter((e) => e.level === level);
const lastCallHeaders = () => globalThis.fetch.mock.calls.at(-1)[1].headers;

beforeEach(() => {
  emitted.length = 0;
  languageLog.endRun();
  globalThis.fetch = vi.fn();
});
afterEach(() => { delete globalThis.fetch; });

describe('languageApi failure reporting', () => {
  it('logs an error when the request throws instead of failing silently', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'));

    const result = await languageApi.courses();

    // The contract the rungs depend on is unchanged...
    expect(result).toEqual({ ok: false, status: 0, data: null });
    // ...but status 0 is no longer indistinguishable from a real status 0.
    const failures = events('error');
    expect(failures).toHaveLength(1);
    expect(failures[0].event).toBe('school.language.api.failed');
    expect(failures[0].data).toMatchObject({
      path: '/courses',
      method: 'GET',
      status: 0,
      error: 'NetworkError when attempting to fetch resource.',
    });
    expect(typeof failures[0].data.ms).toBe('number');
  });

  it('logs a non-ok response at warn, with its status', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'internal' }) });

    const result = await languageApi.day('test-user', 'ko-basic', {}, 'grant-1');

    expect(result.status).toBe(500);
    const rejected = events('warn').filter((e) => e.event === 'school.language.api.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].data).toMatchObject({ path: '/users/test-user/day', method: 'GET', status: 500 });
    expect(events('error')).toHaveLength(0);
  });

  it('logs a success at debug, with a duration', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ queue: [] }) });

    await languageApi.courses();

    const ok = events('debug').filter((e) => e.event === 'school.language.api.ok');
    expect(ok).toHaveLength(1);
    expect(ok[0].data).toMatchObject({ path: '/courses', method: 'GET', status: 200 });
    expect(typeof ok[0].data.ms).toBe('number');
  });

  it('treats an aborted request as a cancel, not a fault', async () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    globalThis.fetch.mockRejectedValue(abort);

    await languageApi.previewDay('ko-basic', {}, new AbortController().signal);

    expect(events('error')).toHaveLength(0);
    expect(events('debug').map((e) => e.event)).toContain('school.language.api.aborted');
  });

  it('never puts a request body or a response payload in the log', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ correct: '나는 학생입니다' }) });

    await languageApi.log('test-user', { corpus: 'ko-basic', seq: 4, rung: 'dictation', given: '나는 학생' }, {}, 'grant-1');

    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('나는');
    expect(serialized).not.toContain('given');
  });
});

describe('run id correlation', () => {
  it('sends the current run id as a header on every request', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const runId = languageLog.startRun();
    expect(runId).toBeTruthy();

    await languageApi.courses();
    expect(lastCallHeaders()['X-School-Run-Id']).toBe(runId);

    await languageApi.recording('test-user', 'ko-basic', 4, new Blob(['x'], { type: 'audio/webm' }), {}, 'grant-1');
    expect(lastCallHeaders()['X-School-Run-Id']).toBe(runId);

    await languageApi.recordingBlob('test-user', 'ko-basic', 4, 'grant-1');
    expect(lastCallHeaders()['X-School-Run-Id']).toBe(runId);
  });

  it('sends no run header before a run has been minted', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await languageApi.courses();

    expect(lastCallHeaders()['X-School-Run-Id']).toBeUndefined();
  });

  it('puts the run id on the log context, where the store indexes it', async () => {
    globalThis.fetch.mockRejectedValue(new Error('offline'));
    const runId = languageLog.startRun();

    await languageApi.courses();

    expect(events('error')[0].context).toMatchObject({ component: 'school-language', runId });
  });

  it('a run id set for one run does not leak into the next', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const first = languageLog.startRun();
    const second = languageLog.startRun();
    expect(second).not.toBe(first);

    languageLog.endRun();
    await languageApi.courses();
    expect(lastCallHeaders()['X-School-Run-Id']).toBeUndefined();
  });
});
