#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
// The SAME codec the backend decodes with. A CLI that rolled its own base64
// would be a second opinion about what a link means, and the first time the
// payload gains a field the tool would quietly emit links the panel refuses.
import { encodeLaunchPreviewLink } from '#apps/school/services/launchPreviewLink.mjs';

const DEFAULT_BASE = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school';

const HELP = `school ops — runtime School diagnosis and guarded repairs

Read-only:
  school ops completion <learner> [--base-url URL]
  school ops status <learner> [--base-url URL]
  school ops monitor <learner...> [--watch] [--interval 15]
  school ops timeline <learner> --teacher ID --pin-env NAME [--limit 50] [--before ISO] [--unit ID]
  school ops session <session> --teacher ID --pin-env NAME
  school ops gates <learner>
  school ops audit [--since ISO]
  school ops artifact <artifact> --teacher ID --pin-env NAME [--view manifest|original|postview] [--output FILE]
  school ops agenda-preview <learner> [--name NAME] [--output agenda.png]
  school ops launch-preview <learner> --subject ID [--continue] [--resolve]
                                      [--origin URL] [--path /school]

Writes to the household reading log directly, no server needed (dry-run by
default, add --apply):
  school ops read <learner> [--title TEXT] [--content ID] [--location ROOM]
                            [--pick ID] [--apply]

Dry-run/preview by default; add --apply to write:
  school ops assign <learner> --file plan.yml --teacher ID --pin-env NAME [--apply]
  school ops enroll <learner> --syllabus ID --teacher ID --pin-env NAME [--apply]
  school ops rematerialize <learner> --syllabus ID --teacher ID --pin-env NAME [--apply]
  school ops abandon <session> --learner ID --reason TEXT --teacher ID --pin-env NAME [--apply]
  school ops agenda-dispatch <learner> --teacher ID --pin-env NAME [--name NAME] [--idempotency-key KEY] [--apply]
  school ops grade-adjust <session> --percent N --reason TEXT --teacher ID --pin-env NAME [--base-revision N] [--apply]
  school ops grade-retract <session> --adjustment ID --reason TEXT --teacher ID --pin-env NAME [--base-revision N] [--apply]
  school ops completion-credit <learner> --unit ID --reason TEXT --teacher ID --pin-env NAME [--apply]
  school ops completion-credit-retract <entry> --teacher ID --pin-env NAME [--apply]
  school ops regrade <bank> --from-day YYYY-MM-DD --reason TEXT --teacher ID --pin-env NAME [--to-day YYYY-MM-DD] [--apply]
  school ops reassign <assessment> --from ID --to ID --day YYYY-MM-DD --teacher ID --pin-env NAME [--apply]

read refuses a learner id that is not in school.yml students: a typo is a
well-formed id, and appending under it would print success while counting the
read against nobody. --pick is an idempotency key: the same one twice records
one read. read is the MANUAL path for a story a child finished — a book read on a lap,
a mis-scanned sticker. It needs no PIN and no running server: it appends
straight to the study-day-sharded reading log the story-time launcher counts,
which the server re-reads on every status call. Because there is no bus, it
records the read WITHOUT the on-screen ceremony a real living-room finish gets.

launch-preview writes NOTHING and needs no PIN: it is a link generator. The
URL it prints opens a learner's launch card exactly as the wall panel would
draw it — same resolver, same card builder — with every button dead. No code is
minted, no session opens, nothing prints.

Base URLs ending in either /school or /school/lifecycle are accepted. Teacher
PINs are read only from the named environment variable and are never printed.
Commands always emit one stable JSON document; PDF/PNG bytes require --output.
`;

const VALUE_OPTIONS = new Set([
  '--base-url', '--interval', '--file', '--teacher', '--pin-env', '--syllabus',
  '--learner', '--reason', '--limit', '--before', '--unit', '--since', '--view',
  '--output', '--name', '--idempotency-key', '--percent', '--correct', '--total',
  '--missed', '--verdicts', '--base-revision', '--base-seq', '--adjustment',
  '--from-day', '--to-day', '--from', '--to', '--day',
  '--subject', '--origin', '--path', '--title', '--content', '--location', '--pick',
]);

export function option(argv, name, fallback = null) {
  const at = argv.indexOf(name);
  if (at >= 0) return argv[at + 1] ?? fallback;
  // `--title="The Jungle Book"` is what a person actually types, and what the
  // runbooks are written with. Reading only the space-separated form dropped
  // the value silently — a title-less read is indistinguishable from one that
  // never carried a title.
  const joined = argv.find((arg) => arg.startsWith(`${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 1);
}

function positionals(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (VALUE_OPTIONS.has(argv[i])) { i += 1; continue; }
    if (!argv[i].startsWith('--')) out.push(argv[i]);
  }
  return out;
}

function bases(raw) {
  const normalized = String(raw || DEFAULT_BASE).replace(/\/+$/, '');
  if (normalized.endsWith('/lifecycle')) {
    return { school: normalized.slice(0, -'/lifecycle'.length), lifecycle: normalized };
  }
  return { school: normalized, lifecycle: `${normalized}/lifecycle` };
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

async function responseError(response) {
  const data = await response.json().catch(() => null);
  return new Error(`${response.status} ${data?.error ?? response.statusText}`.trim());
}

async function requestJson(fetchImpl, base, requestPath, options = {}) {
  const response = await fetchImpl(`${base}${requestPath}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

async function requestBytes(fetchImpl, base, requestPath, options = {}) {
  const response = await fetchImpl(`${base}${requestPath}`, options);
  if (!response.ok) throw await responseError(response);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers?.get?.('content-type') ?? null };
}

async function snapshot(fetchImpl, base, learnerId) {
  const enc = encodeURIComponent(learnerId);
  const [completion, assignment, sessions] = await Promise.all([
    requestJson(fetchImpl, base.lifecycle, `/learners/${enc}/completion`),
    requestJson(fetchImpl, base.lifecycle, `/assignments/${enc}`).catch((error) => ({ error: error.message })),
    requestJson(fetchImpl, base.lifecycle, `/learners/${enc}/sessions?window=today`).catch((error) => ({ error: error.message })),
  ]);
  return { schema: 'school.ops-status/v1', learnerId, completion, assignment, sessions: sessions.sessions ?? sessions };
}

function pinFrom(argv, env) {
  const name = option(argv, '--pin-env');
  if (!name) throw new Error('--pin-env NAME is required for a teacher operation');
  const pin = env[name];
  if (!pin) throw new Error(`environment variable ${name} is empty`);
  return pin;
}

function requiredOption(argv, name, message = `${name} is required`) {
  const value = option(argv, name);
  if (value === null || value === '') throw new Error(message);
  return value;
}

function optionalNumber(argv, ...names) {
  const raw = names.map((name) => option(argv, name)).find((value) => value !== null);
  if (raw === undefined || raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${names[0]} must be a number`);
  return value;
}

function print(value, stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function redactedRequest({ method, url, body, headers = {} }) {
  return {
    method, url,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(body ? { body: { ...body, ...(Object.hasOwn(body, 'pin') ? { pin: '[from environment]' } : {}) } } : {}),
  };
}

async function writeDownload({ fetchImpl, base, requestPath, output, headers = {} }) {
  if (!output) throw new Error('--output FILE is required for a PDF or PNG view');
  const result = await requestBytes(fetchImpl, base, requestPath, { headers });
  const target = path.resolve(output);
  fs.writeFileSync(target, result.bytes);
  return { output: target, bytes: result.bytes.length, contentType: result.contentType };
}

async function teacherProof({ fetchImpl, school, teacher, pin }) {
  const unlockResponse = await fetchImpl(`${school}/teacher/auth/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: teacher, pin }),
  });
  if (!unlockResponse.ok) throw await responseError(unlockResponse);
  const cookie = unlockResponse.headers?.get?.('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('teacher unlock did not return a session cookie');
  return { cookie, async stepUp(action, resource) {
    const result = await requestJson(fetchImpl, school, '/teacher/auth/step-up', {
      method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ pin, action, resource }),
    });
    return result.grantToken;
  } };
}

export async function runOps({
  argv, fetchImpl = globalThis.fetch, env = process.env, stdout = process.stdout,
  // Injected by tests only; production resolves the real singleton lazily, so
  // no command that never touches the data tree pays for loading it.
  configService = null,
} = {}) {
  const [command, ...rest] = argv ?? [];
  if (!command || ['help', '--help', '-h'].includes(command)) { stdout.write(HELP); return 0; }
  const args = positionals(rest);
  const base = bases(option(rest, '--base-url', DEFAULT_BASE));
  const apply = rest.includes('--apply');
  const enc = (value) => encodeURIComponent(value);

  if (command === 'completion') {
    if (!args[0]) throw new Error('completion requires a learner id');
    print(await requestJson(fetchImpl, base.lifecycle, `/learners/${enc(args[0])}/completion`), stdout); return 0;
  }
  if (command === 'status') {
    if (!args[0]) throw new Error('status requires a learner id');
    print(await snapshot(fetchImpl, base, args[0]), stdout); return 0;
  }
  if (command === 'monitor') {
    if (!args.length) throw new Error('monitor requires at least one learner id');
    const intervalSeconds = Math.max(5, Number(option(rest, '--interval', 15)) || 15);
    do {
      const rows = await Promise.all(args.map((id) => snapshot(fetchImpl, base, id)));
      print({ schema: 'school.ops-monitor/v1', observedAt: new Date().toISOString(), learners: rows }, stdout);
      if (!rest.includes('--watch')) break;
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    } while (true);
    return 0;
  }
  if (command === 'timeline') {
    if (!args[0]) throw new Error('timeline requires a learner id');
    const teacher = requiredOption(rest, '--teacher', '--teacher ID is required for a teacher record read');
    const proof = await teacherProof({ fetchImpl, school: base.school, teacher, pin: pinFrom(rest, env) });
    const suffix = query({ limit: option(rest, '--limit'), before: option(rest, '--before'), unitId: option(rest, '--unit') });
    print(await requestJson(fetchImpl, base.school, `/teacher/learners/${enc(args[0])}/timeline${suffix}`, {
      headers: { Cookie: proof.cookie },
    }), stdout); return 0;
  }
  if (command === 'session') {
    if (!args[0]) throw new Error('session requires a session id');
    const teacher = requiredOption(rest, '--teacher', '--teacher ID is required for a teacher record read');
    const proof = await teacherProof({ fetchImpl, school: base.school, teacher, pin: pinFrom(rest, env) });
    print(await requestJson(fetchImpl, base.school, `/teacher/sessions/${enc(args[0])}`, {
      headers: { Cookie: proof.cookie },
    }), stdout); return 0;
  }
  if (command === 'gates') {
    if (!args[0]) throw new Error('gates requires a learner id');
    const learnerId = args[0]; const learner = enc(learnerId);
    const [completion, assignment, milestones, passOverrides] = await Promise.all([
      requestJson(fetchImpl, base.lifecycle, `/learners/${learner}/completion`),
      requestJson(fetchImpl, base.lifecycle, `/assignments/${learner}`).catch((error) => ({ error: error.message })),
      requestJson(fetchImpl, base.school, `/milestones?learnerId=${learner}`).catch((error) => ({ error: error.message })),
      requestJson(fetchImpl, base.school, '/pass-overrides').catch((error) => ({ error: error.message })),
    ]);
    print({ schema: 'school.instructional-gates/v1', learnerId, completion, assignment, milestones, passOverrides }, stdout); return 0;
  }
  // A LINK GENERATOR, and deliberately nothing more. Hand-rolling base64url
  // for a JSON blob is exactly the friction the preview route exists to
  // remove, so the tool that removes it must not reintroduce ceremony of its
  // own: no PIN, no teacher unlock, no writes. `--resolve` additionally fetches
  // the card so the terminal can answer "does this course's poster resolve?"
  // without opening a browser — still a read, still mints nothing.
  if (command === 'launch-preview') {
    const learnerId = args[0];
    if (!learnerId) throw new Error('launch-preview requires a learner id');
    const subject = requiredOption(rest, '--subject', '--subject ID is required');
    const link = encodeLaunchPreviewLink({
      learnerId, subject, continueToday: rest.includes('--continue'),
    });
    // Defaults to the origin the API base already names, so the common case is
    // `school ops launch-preview learner4 --subject arts` and nothing else.
    const origin = option(rest, '--origin') ?? new URL(base.school).origin;
    const appPath = String(option(rest, '--path', '/school')).replace(/\/+$/, '');
    const previewApi = `${base.school}/self-service/preview/${enc(link)}`;
    const result = {
      schema: 'school.launch-preview-link/v1',
      learnerId,
      subject,
      continueToday: rest.includes('--continue'),
      link,
      url: `${origin}${appPath}/launch-preview/${link}`,
      api: previewApi,
      mints: 'nothing',
    };
    if (rest.includes('--resolve')) {
      result.card = await requestJson(fetchImpl, base.school, `/self-service/preview/${enc(link)}`)
        .catch((error) => ({ error: error.message }));
    }
    print(result, stdout);
    return 0;
  }
  // A LOCAL WRITE, deliberately — the only ops command that does not go through
  // the API. There is no HTTP door for a story read yet (plan 03 brings the
  // living-room reader), and the manual-correction path must work when the
  // server is down, which is exactly when a parent is most likely to be
  // reaching for it. Safe because the reading log is a plain study-day-sharded
  // file the running server re-reads on every status call — there is no cache
  // to go stale and no in-process authority to fight.
  if (command === 'read') {
    const learnerId = args[0];
    if (!learnerId) throw new Error('read requires a learner id');
    const [{ YamlReadingLogStore }, { YamlAssignmentStore }, { RecordStoryRead }, { StoryTimeProgramLauncher }] = await Promise.all([
      import('#adapters/persistence/yaml/YamlReadingLogStore.mjs'),
      import('#adapters/persistence/yaml/YamlAssignmentStore.mjs'),
      import('#apps/school/usecases/RecordStoryRead.mjs'),
      import('#apps/school/StoryTimeProgramLauncher.mjs'),
    ]);
    const config = configService ?? await (await import('../_bootstrap.mjs')).getConfigService();

    // RESOLVE THE ID, DO NOT TRUST IT. `append` validates only the SHAPE of a
    // learner id, so a typo is a perfectly well-formed id: it creates a fresh
    // directory, prints success, and the read is never counted against anyone.
    // This is the manual-correction command, which makes a typo its single
    // most likely input. Fail closed on an unreadable roster too — silently
    // accepting anything is the exact failure being closed off here.
    const roster = config.getHouseholdAppConfig?.(null, 'school')?.students ?? [];
    if (!roster.length) throw new Error('school.yml lists no students: cannot check the learner id');
    if (!roster.includes(learnerId)) {
      throw new Error(`unknown learner '${learnerId}' — school.yml students: ${roster.join(', ')}`);
    }

    const silent = { info() {}, warn() {}, error() {}, debug() {} };
    const store = new YamlReadingLogStore({ configService: config, logger: console });
    // The launcher is built for its `studyDay()` — the ONE place the
    // household's 4am boundary is applied — and then answers "is the day done
    // now" off the same enrollment the board reads.
    const launcher = new StoryTimeProgramLauncher({
      readingLog: store,
      assignments: new YamlAssignmentStore({ configService: config, logger: silent }),
      timezone: config.getTimezone?.() || null,
      logger: silent,
    });
    // The row goes through the SAME use case either way, and the store is
    // wrapped rather than swapped — so a dry run prints exactly what an
    // --apply would write, study-day stamp included, instead of a second guess
    // at it. The use case's own logger is silenced because this command emits
    // one stable JSON document on stdout and nothing else.
    const captured = [];
    await new RecordStoryRead({
      readingLog: { append: async (row) => { captured.push(row); return apply ? store.append(row) : row; } },
      studyDay: () => launcher.studyDay(),
      logger: silent,
    }).execute({
      learnerId,
      title: option(rest, '--title'),
      contentId: option(rest, '--content'),
      location: option(rest, '--location'),
      pickId: option(rest, '--pick'),
    });
    if (!apply) {
      print({ schema: 'school.ops-dry-run/v1', dryRun: true, write: { kind: 'story-read', row: captured[0] } }, stdout);
      return 0;
    }
    // What a parent actually wants to know after recording it by hand: is the
    // child done now. Read back through the launcher rather than counting
    // here, so this cannot disagree with the board.
    const after = await launcher.status({ userId: learnerId });
    print({
      schema: 'school.story-read/v1',
      ...captured[0],
      status: { count: after.count, target: after.target, doneToday: after.doneToday, progressLabel: after.progressLabel },
    }, stdout);
    return 0;
  }
  if (command === 'audit') {
    print(await requestJson(fetchImpl, base.school, `/audit${query({ since: option(rest, '--since') })}`), stdout); return 0;
  }
  if (command === 'agenda-preview') {
    if (!args[0]) throw new Error('agenda-preview requires a learner id');
    const output = option(rest, '--output');
    const suffix = query({ name: option(rest, '--name'), ...(output ? {} : { format: 'json' }) });
    if (output) {
      const saved = await writeDownload({ fetchImpl, base: base.lifecycle,
        requestPath: `/learners/${enc(args[0])}/agenda/preview${suffix}`, output });
      print({ schema: 'school.ops-download/v1', kind: 'agenda-preview', learnerId: args[0], ...saved }, stdout);
    } else print(await requestJson(fetchImpl, base.lifecycle, `/learners/${enc(args[0])}/agenda/preview${suffix}`), stdout);
    return 0;
  }
  if (command === 'artifact') {
    const artifactId = args[0];
    if (!artifactId) throw new Error('artifact requires an artifact id');
    const view = option(rest, '--view', 'manifest');
    const teacher = requiredOption(rest, '--teacher', '--teacher ID is required for an artifact read');
    const proof = await teacherProof({ fetchImpl, school: base.school, teacher, pin: pinFrom(rest, env) });
    const headers = { Cookie: proof.cookie };
    if (view === 'manifest') {
      print(await requestJson(fetchImpl, base.school, `/teacher/artifacts/${enc(artifactId)}`, { headers }), stdout); return 0;
    }
    if (!['original', 'postview'].includes(view)) throw new Error('--view must be manifest, original, or postview');
    const output = requiredOption(rest, '--output', '--output FILE is required for a PDF or PNG view');
    if (view === 'postview') {
      headers['X-Teacher-Step-Up'] = await proof.stepUp('artifact.postview', artifactId);
    }
    const saved = await writeDownload({ fetchImpl, base: base.school,
      requestPath: `/teacher/artifacts/${enc(artifactId)}/${view}.pdf`, output, headers });
    print({ schema: 'school.ops-download/v1', kind: `artifact-${view}`, artifactId, ...saved }, stdout); return 0;
  }

  const teacher = option(rest, '--teacher');
  if (!teacher) throw new Error('--teacher ID is required for a teacher operation');
  const pin = pinFrom(rest, env);
  let method = 'POST'; let requestBase = base.lifecycle; let requestPath; let body; let headers = {};
  let previewViaApi = false;

  if (command === 'assign') {
    const learnerId = args[0]; const file = option(rest, '--file');
    if (!learnerId || !file) throw new Error('assign requires learner id and --file plan.yml');
    const plan = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
    const current = await requestJson(fetchImpl, base.lifecycle, `/assignments/${enc(learnerId)}`).catch(() => null);
    method = 'PUT'; requestPath = `/assignments/${enc(learnerId)}`;
    body = { courses: plan.courses ?? plan.enrollments ?? [], units: plan.units ?? plan.standaloneWork ?? [],
      programs: plan.programs ?? [], assignedBy: teacher, pin, baseUpdatedAt: current?.updatedAt ?? undefined };
  } else if (command === 'enroll' || command === 'rematerialize') {
    const learnerId = args[0]; const syllabusId = option(rest, '--syllabus');
    if (!learnerId || !syllabusId) throw new Error(`${command} requires learner id and --syllabus ID`);
    const current = await requestJson(fetchImpl, base.lifecycle, `/assignments/${enc(learnerId)}`).catch(() => null);
    requestPath = `/enrollments/${enc(learnerId)}`;
    body = { syllabusId, rematerialize: command === 'rematerialize', enrolledBy: teacher, pin,
      baseUpdatedAt: current?.updatedAt ?? undefined };
  } else if (command === 'abandon') {
    const sessionId = args[0]; const learnerId = option(rest, '--learner'); const reason = option(rest, '--reason');
    if (!sessionId || !learnerId || !reason) throw new Error('abandon requires session, --learner, and --reason');
    requestPath = `/sessions/${enc(sessionId)}/abandon`; body = { learnerId, reason, decidedBy: teacher, pin };
  } else if (command === 'agenda-dispatch') {
    const learnerId = args[0]; if (!learnerId) throw new Error('agenda-dispatch requires a learner id');
    requestBase = base.school; requestPath = `/teacher/learners/${enc(learnerId)}/agenda/dispatch${apply ? '' : '/preview'}`;
    body = apply ? { learnerName: option(rest, '--name'), dispatchedBy: teacher, pin }
      : { learnerName: option(rest, '--name') };
    if (apply) {
      const key = requiredOption(rest, '--idempotency-key', '--idempotency-key KEY is required with --apply');
      headers = { 'Idempotency-Key': key };
    } else previewViaApi = true;
  } else if (command === 'grade-adjust') {
    const sessionId = args[0]; if (!sessionId) throw new Error('grade-adjust requires a session id');
    requestBase = base.school; requestPath = `/teacher/sessions/${enc(sessionId)}/grade-adjustments`; previewViaApi = true;
    const verdictsFile = option(rest, '--verdicts');
    body = { percent: optionalNumber(rest, '--percent'), correctCount: optionalNumber(rest, '--correct'),
      totalCount: optionalNumber(rest, '--total'),
      missedItemIds: option(rest, '--missed')?.split(',').map((item) => item.trim()).filter(Boolean),
      itemVerdicts: verdictsFile ? yaml.load(fs.readFileSync(verdictsFile, 'utf8')) : undefined,
      reason: requiredOption(rest, '--reason'), adjustedBy: teacher, pin,
      baseSeq: optionalNumber(rest, '--base-revision', '--base-seq'), apply };
  } else if (command === 'grade-retract') {
    const sessionId = args[0]; const adjustmentId = option(rest, '--adjustment');
    if (!sessionId || !adjustmentId) throw new Error('grade-retract requires session and --adjustment ID');
    requestBase = base.school; requestPath = `/teacher/sessions/${enc(sessionId)}/grade-adjustments/${enc(adjustmentId)}/retract`;
    previewViaApi = true; body = { reason: requiredOption(rest, '--reason'), retractedBy: teacher, pin,
      baseSeq: optionalNumber(rest, '--base-revision', '--base-seq'), apply };
  } else if (command === 'completion-credit') {
    const learnerId = args[0]; const unitId = option(rest, '--unit');
    if (!learnerId || !unitId) throw new Error('completion-credit requires learner and --unit ID');
    requestBase = base.school; requestPath = '/attestations';
    body = { learnerId, unitId, reason: requiredOption(rest, '--reason'), attestedBy: teacher, pin };
  } else if (command === 'completion-credit-retract') {
    if (!args[0]) throw new Error('completion-credit-retract requires an entry id');
    requestBase = base.school; requestPath = '/retract';
    body = { kind: 'attestation', entryId: args[0], retractedBy: teacher, pin };
  } else if (command === 'regrade') {
    const bankId = args[0]; if (!bankId) throw new Error('regrade requires a bank id');
    requestBase = base.school; requestPath = '/attempts/regrade'; previewViaApi = true;
    body = { bankId, fromDay: requiredOption(rest, '--from-day'), toDay: option(rest, '--to-day'),
      reason: requiredOption(rest, '--reason'), regradedBy: teacher, pin, apply };
  } else if (command === 'reassign') {
    const assessmentId = args[0]; const fromLearnerId = option(rest, '--from'); const toLearnerId = option(rest, '--to');
    if (!assessmentId || !fromLearnerId || !toLearnerId) throw new Error('reassign requires assessment, --from ID, and --to ID');
    requestBase = base.school; requestPath = '/reassign';
    body = { fromLearnerId, toLearnerId, day: requiredOption(rest, '--day'), assessmentId, reassignedBy: teacher, pin };
  } else throw new Error(`unknown school ops command: ${command}`);

  if (!apply && !previewViaApi) {
    print({ schema: 'school.ops-dry-run/v1', dryRun: true,
      request: redactedRequest({ method, url: `${requestBase}${requestPath}`, body, headers }) }, stdout);
    return 0;
  }
  const result = await requestJson(fetchImpl, requestBase, requestPath, { method, headers, body: JSON.stringify(body) });
  print(!apply && previewViaApi ? { schema: 'school.ops-preview/v1', dryRun: true, preview: result } : result, stdout);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  return runOps({ argv });
}
