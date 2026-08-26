import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { option, runOps } from './ops.mjs';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, statusText: '',
  headers: { get: () => null }, json: async () => body,
});

const bytesResponse = (body, contentType = 'application/pdf') => ({
  ok: true, status: 200, statusText: '', headers: { get: (name) => name === 'content-type' ? contentType : null },
  arrayBuffer: async () => Buffer.from(body),
});

const unlockResponse = () => ({
  ...response({ active: true }),
  headers: { get: (name) => name === 'set-cookie' ? 'daylight_teacher_session=cap; Path=/; HttpOnly' : null },
});

describe('school ops', () => {
  it('aggregates completion, assignment, and today sessions for diagnosis', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/completion')) return response({ state: 'indeterminate', faults: [{ reason: 'plan_error' }] });
      if (url.includes('/assignments/')) return response({ learnerId: 'learner3', programs: [] });
      return response({ sessions: [] });
    });
    let output = '';
    await runOps({ argv: ['status', 'learner3', '--base-url', 'http://school'], fetchImpl, stdout: { write: (s) => { output += s; } } });
    expect(JSON.parse(output).completion.state).toBe('indeterminate');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps enrollment dry-run by default and redacts the PIN', async () => {
    const fetchImpl = vi.fn(async () => response({ learnerId: 'learner3', updatedAt: 'v1' }));
    let output = '';
    await runOps({
      argv: ['rematerialize', 'learner3', '--syllabus', 'cfm-lower', '--teacher', 'dad', '--pin-env', 'PIN'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write: (s) => { output += s; } },
    });
    expect(output).toContain('"dryRun": true');
    expect(output).not.toContain('7410');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts both school-root and lifecycle base URLs without duplicating lifecycle', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (url) => { urls.push(url); return response({ state: 'complete' }); });
    await runOps({ argv: ['completion', 'kid', '--base-url', 'http://host/api/v1/school'], fetchImpl, stdout: { write() {} } });
    await runOps({ argv: ['completion', 'kid', '--base-url', 'http://host/api/v1/school/lifecycle'], fetchImpl, stdout: { write() {} } });
    expect(urls).toEqual([
      'http://host/api/v1/school/lifecycle/learners/kid/completion',
      'http://host/api/v1/school/lifecycle/learners/kid/completion',
    ]);
  });

  it('routes teacher timeline and session reads to the school root from a lifecycle base', async () => {
    const fetchImpl = vi.fn(async (url) => url.endsWith('/auth/unlock') ? unlockResponse() : response({ items: [] }));
    await runOps({
      argv: ['timeline', 'kid', '--limit', '20', '--unit', 'math', '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://host/school/lifecycle'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write() {} },
    });
    await runOps({
      argv: ['session', 'ses 1', '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://host/school/lifecycle'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write() {} },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe('http://host/school/teacher/learners/kid/timeline?limit=20&unitId=math');
    expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe('daylight_teacher_session=cap');
    expect(fetchImpl.mock.calls[3][0]).toBe('http://host/school/teacher/sessions/ses%201');
    expect(fetchImpl.mock.calls[3][1].headers.Cookie).toBe('daylight_teacher_session=cap');
  });

  it('collects the instructional gate evidence without failing the whole view on an optional source', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/completion')) return response({ state: 'blocked' });
      if (url.includes('/assignments/')) return response({ error: 'missing' }, 404);
      if (url.includes('/milestones')) return response({ milestones: [{ unitId: 'u1', status: 'blocked' }] });
      return response({ overrides: { u1: 90 } });
    });
    let output = '';
    await runOps({ argv: ['gates', 'kid', '--base-url', 'http://school'], fetchImpl, stdout: { write: (s) => { output += s; } } });
    const parsed = JSON.parse(output);
    expect(parsed.schema).toBe('school.instructional-gates/v1');
    expect(parsed.assignment.error).toMatch(/^404/);
    expect(parsed.passOverrides.overrides.u1).toBe(90);
  });

  it('downloads exact artifact bytes and emits a JSON receipt, never binary stdout', async () => {
    const fetchImpl = vi.fn(async (url) => url.endsWith('/auth/unlock') ? unlockResponse() : bytesResponse('%PDF exact'));
    const output = `${process.env.TMPDIR ?? '/tmp'}/school-ops-artifact-${Date.now()}.pdf`;
    let stdout = '';
    try {
      await runOps({ argv: ['artifact', 'art 1', '--view', 'original', '--output', output, '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
        fetchImpl, env: { PIN: '7410' }, stdout: { write: (s) => { stdout += s; } } });
      expect(fs.readFileSync(output, 'utf8')).toBe('%PDF exact');
      expect(JSON.parse(stdout)).toMatchObject({ schema: 'school.ops-download/v1', kind: 'artifact-original', bytes: 10 });
      expect(fetchImpl.mock.calls[1][0]).toBe('http://school/teacher/artifacts/art%201/original.pdf');
      expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe('daylight_teacher_session=cap');
    } finally { fs.rmSync(output, { force: true }); }
  });

  it('performs unlock and scoped step-up before downloading a sensitive postview', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/auth/unlock')) return unlockResponse();
      if (url.endsWith('/auth/step-up')) return response({ grantToken: 'grant' });
      return bytesResponse('%PDF post');
    });
    const output = `${process.env.TMPDIR ?? '/tmp'}/school-ops-postview-${Date.now()}.pdf`;
    try {
      await runOps({ argv: ['artifact', 'art1', '--view', 'postview', '--output', output, '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
        fetchImpl, env: { PIN: '7410' }, stdout: { write() {} } });
      const stepUp = fetchImpl.mock.calls[1][1];
      expect(JSON.parse(stepUp.body)).toEqual({ pin: '7410', action: 'artifact.postview', resource: 'art1' });
      expect(fetchImpl.mock.calls[2][1].headers).toMatchObject({ Cookie: 'daylight_teacher_session=cap', 'X-Teacher-Step-Up': 'grant' });
    } finally { fs.rmSync(output, { force: true }); }
  });

  it('calls the real no-side-effect agenda preview on dry-run dispatch', async () => {
    const fetchImpl = vi.fn(async () => response({ schema: 'school.agenda-dispatch-preview/v1', ready: true }));
    let output = '';
    await runOps({ argv: ['agenda-dispatch', 'kid', '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
      fetchImpl, env: { PIN: 'secret' }, stdout: { write: (s) => { output += s; } } });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://school/teacher/learners/kid/agenda/dispatch/preview');
    expect(fetchImpl.mock.calls[0][1].body).not.toContain('secret');
    expect(JSON.parse(output)).toMatchObject({ schema: 'school.ops-preview/v1', dryRun: true, preview: { ready: true } });
  });

  it('requires an idempotency key and forwards it for applied agenda dispatch', async () => {
    await expect(runOps({ argv: ['agenda-dispatch', 'kid', '--teacher', 'dad', '--pin-env', 'PIN', '--apply'],
      fetchImpl: vi.fn(), env: { PIN: '7410' }, stdout: { write() {} } })).rejects.toThrow(/idempotency-key/);
    const fetchImpl = vi.fn(async () => response({ printed: true }));
    await runOps({ argv: ['agenda-dispatch', 'kid', '--teacher', 'dad', '--pin-env', 'PIN', '--idempotency-key', 'op-1', '--apply', '--base-url', 'http://school'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write() {} } });
    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key']).toBe('op-1');
  });

  it('previews grade adjustment with base revision and applies only when requested', async () => {
    const fetchImpl = vi.fn(async (_url, init) => response({ applied: JSON.parse(init.body).apply }));
    let output = '';
    await runOps({ argv: ['grade-adjust', 'ses1', '--percent', '100', '--reason', 'eraser', '--base-revision', '7', '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write: (s) => { output += s; } } });
    const previewBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(previewBody).toMatchObject({ percent: 100, reason: 'eraser', baseSeq: 7, apply: false });
    expect(output).not.toContain('7410');
    await runOps({ argv: ['grade-adjust', 'ses1', '--percent', '100', '--reason', 'eraser', '--teacher', 'dad', '--pin-env', 'PIN', '--apply', '--base-url', 'http://school'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write() {} } });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).apply).toBe(true);
  });

  it('keeps completion credit, retraction, and reassignment as redacted local dry-runs', async () => {
    for (const argv of [
      ['completion-credit', 'kid', '--unit', 'u1', '--reason', 'bad question'],
      ['completion-credit-retract', 'att_1'],
      ['reassign', 'ses1', '--from', 'kid', '--to', 'other', '--day', '2026-08-23'],
    ]) {
      let output = '';
      await runOps({ argv: [...argv, '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
        fetchImpl: vi.fn(), env: { PIN: '7410' }, stdout: { write: (s) => { output += s; } } });
      expect(JSON.parse(output)).toMatchObject({ schema: 'school.ops-dry-run/v1', dryRun: true });
      expect(output).not.toContain('7410');
    }
  });

  it('generates a launch-card preview link without talking to anything', async () => {
    const fetchImpl = vi.fn();
    let output = '';
    await runOps({
      argv: ['launch-preview', 'learner4', '--subject', 'arts', '--base-url', 'http://host/api/v1/school'],
      fetchImpl, stdout: { write: (s) => { output += s; } },
    });
    const result = JSON.parse(output);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.url).toBe(`http://host/school/launch-preview/${result.link}`);
    expect(result.api).toBe(`http://host/api/v1/school/self-service/preview/${result.link}`);
    expect(JSON.parse(Buffer.from(result.link, 'base64url').toString('utf8')))
      .toEqual({ learnerId: 'learner4', subject: 'arts' });
  });

  it('--continue rides along, and --resolve reads the card back without writing', async () => {
    const fetchImpl = vi.fn(async () => response({ ok: true, preview: true, actions: [{ kind: 'program', inert: true }] }));
    let output = '';
    await runOps({
      argv: ['launch-preview', 'learner4', '--subject', 'arts', '--continue', '--resolve',
        '--origin', 'https://portal.example', '--path', '/screens/portal', '--base-url', 'http://host/api/v1/school'],
      fetchImpl, stdout: { write: (s) => { output += s; } },
    });
    const result = JSON.parse(output);
    expect(result.continueToday).toBe(true);
    expect(result.url.startsWith('https://portal.example/screens/portal/launch-preview/')).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toContain('/self-service/preview/');
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
    expect(result.card.preview).toBe(true);
  });

  it('refuses to generate a link that names no subject', async () => {
    await expect(runOps({
      argv: ['launch-preview', 'learner4', '--base-url', 'http://school'],
      fetchImpl: vi.fn(), stdout: { write() {} },
    })).rejects.toThrow(/--subject/);
  });

  it('uses the backend dry-run engine for systematic regrades', async () => {
    const fetchImpl = vi.fn(async (_url, init) => response({ changed: 3, applied: JSON.parse(init.body).apply }));
    let output = '';
    await runOps({ argv: ['regrade', 'bank1', '--from-day', '2026-08-01', '--reason', 'bad key', '--teacher', 'dad', '--pin-env', 'PIN', '--base-url', 'http://school'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write: (s) => { output += s; } } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ bankId: 'bank1', apply: false });
    expect(JSON.parse(output).preview.changed).toBe(3);
  });
  // ── school ops read ──────────────────────────────────────────────────────
  // The only ops command that writes locally instead of through the API, and
  // the one whose most likely input is a typo. Everything below runs the REAL
  // store, use case and launcher against a temp tree; only ConfigService is a
  // double.

  const readingTree = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ops-read-'));
  const fakeConfig = (dir, students = ['learner-c']) => ({
    getHouseholdPath: (rel) => path.join(dir, rel),
    getTimezone: () => 'America/Los_Angeles',
    getHouseholdAppConfig: () => ({ students }),
  });
  const runRead = async (argv, config) => {
    let output = '';
    await runOps({ argv, configService: config, stdout: { write: (s2) => { output += s2; } } });
    return JSON.parse(output);
  };

  it('records a read against the study day and reports whether the day is done', async () => {
    const dir = readingTree();
    fs.mkdirSync(path.join(dir, 'school/plans/learners'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'school/plans/learners/learner-c.yml'),
      'learnerId: learner-c\nprograms:\n  - programId: story-time\n    target: 2\n');
    const config = fakeConfig(dir);

    const first = await runRead(['read', 'learner-c', '--title', 'One', '--apply'], config);
    expect(first.status).toMatchObject({ count: 1, target: 2, doneToday: false });
    const second = await runRead(['read', 'learner-c', '--title', 'Two', '--apply'], config);
    expect(second.status).toMatchObject({ count: 2, target: 2, doneToday: true });
    // The shard is the household's own 4am-boundary day, not a UTC date.
    expect(second.studyDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fs.existsSync(path.join(dir, `school/records/reading/learner-c/${second.studyDay}.yml`))).toBe(true);
  });

  it('reads --flag=value, the form the runbooks are written in', async () => {
    const dir = readingTree();
    const row = (await runRead(['read', 'learner-c', '--title=The Jungle Book', '--content=plex:620681'], fakeConfig(dir))).write.row;
    expect(row).toMatchObject({ title: 'The Jungle Book', contentId: 'plex:620681' });
  });

  it('writes nothing without --apply', async () => {
    const dir = readingTree();
    const out = await runRead(['read', 'learner-c', '--title', 'One'], fakeConfig(dir));
    expect(out.dryRun).toBe(true);
    expect(out.write.row).toMatchObject({ learnerId: 'learner-c', title: 'One' });
    expect(fs.existsSync(path.join(dir, 'school/records/reading'))).toBe(false);
  });

  // A typo is a perfectly well-formed learner id: without this the command
  // creates a fresh directory, prints success, and the read counts for nobody.
  it('refuses a learner id that is not on the roster, and writes nothing', async () => {
    const dir = readingTree();
    await expect(runRead(['read', 'learner-see', '--title', 'One', '--apply'], fakeConfig(dir)))
      .rejects.toThrow(/unknown learner/);
    expect(fs.existsSync(path.join(dir, 'school/records/reading'))).toBe(false);
  });

  it('fails closed when the roster itself cannot be read', async () => {
    const dir = readingTree();
    await expect(runRead(['read', 'learner-c', '--apply'], fakeConfig(dir, [])))
      .rejects.toThrow(/no students/);
  });

  it('requires a learner id', async () => {
    await expect(runRead(['read'], fakeConfig(readingTree()))).rejects.toThrow(/learner id/);
  });

  it('carries --pick through to the row so a retry can be recognised', async () => {
    const dir = readingTree();
    const out = await runRead(['read', 'learner-c', '--title', 'One', '--pick=pick_abc'], fakeConfig(dir));
    expect(out.write.row.pickId).toBe('pick_abc');
  });
});

describe('school ops option parsing', () => {
  it('accepts both the spaced and the joined form', () => {
    expect(option(['--title', 'One'], '--title')).toBe('One');
    expect(option(['--title=One'], '--title')).toBe('One');
    expect(option(['--title=a=b'], '--title')).toBe('a=b');
    expect(option([], '--title')).toBe(null);
    expect(option([], '--title', 'fallback')).toBe('fallback');
  });

  // The joined form matches on `name=`, so a shorter flag cannot pick up a
  // longer one's value — `--from` must not read `--from-day`.
  it('cannot cross-match a longer flag with the same prefix', () => {
    expect(option(['--from-day=2026-08-26'], '--from')).toBe(null);
    expect(option(['--from-day=2026-08-26'], '--from-day')).toBe('2026-08-26');
    expect(option(['--base-revision=3'], '--base')).toBe(null);
  });
});
