#!/usr/bin/env node
import fs from 'node:fs';
import yaml from 'js-yaml';

const DEFAULT_BASE = process.env.SCHOOL_BASE_URL || 'http://localhost:3111/api/v1/school/lifecycle';

const HELP = `school ops — runtime School diagnosis and guarded repairs

Read-only:
  school ops completion <learner> [--base-url URL]
  school ops status <learner> [--base-url URL]
  school ops monitor <learner...> [--watch] [--interval 15] [--base-url URL]

Dry-run by default; add --apply to write:
  school ops assign <learner> --file plan.yml --teacher ID --pin-env NAME [--apply]
  school ops enroll <learner> --syllabus ID --teacher ID --pin-env NAME [--apply]
  school ops rematerialize <learner> --syllabus ID --teacher ID --pin-env NAME [--apply]
  school ops abandon <session> --learner ID --reason TEXT --teacher ID --pin-env NAME [--apply]

Teacher PINs are read only from the named environment variable and are never
printed. Mutating commands print their exact redacted request in dry-run mode.
`;

function option(argv, name, fallback = null) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] ?? fallback : fallback;
}

function positionals(argv) {
  const valueOptions = new Set(['--base-url', '--interval', '--file', '--teacher', '--pin-env', '--syllabus', '--learner', '--reason']);
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (valueOptions.has(argv[i])) { i += 1; continue; }
    if (!argv[i].startsWith('--')) out.push(argv[i]);
  }
  return out;
}

async function requestJson(fetchImpl, base, path, options = {}) {
  const response = await fetchImpl(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${data?.error ?? response.statusText}`);
  return data;
}

async function snapshot(fetchImpl, base, learnerId) {
  const enc = encodeURIComponent(learnerId);
  const [completion, assignment, sessions] = await Promise.all([
    requestJson(fetchImpl, base, `/learners/${enc}/completion`),
    requestJson(fetchImpl, base, `/assignments/${enc}`).catch((error) => ({ error: error.message })),
    requestJson(fetchImpl, base, `/learners/${enc}/sessions?window=today`).catch((error) => ({ error: error.message })),
  ]);
  return { learnerId, completion, assignment, sessions: sessions.sessions ?? sessions };
}

function pinFrom(argv, env) {
  const name = option(argv, '--pin-env');
  if (!name) throw new Error('--pin-env NAME is required for a write');
  const pin = env[name];
  if (!pin) throw new Error(`environment variable ${name} is empty`);
  return pin;
}

function print(value, stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runOps({ argv, fetchImpl = globalThis.fetch, env = process.env, stdout = process.stdout } = {}) {
  const [command, ...rest] = argv ?? [];
  if (!command || ['help', '--help', '-h'].includes(command)) { stdout.write(HELP); return 0; }
  const args = positionals(rest);
  const base = String(option(rest, '--base-url', DEFAULT_BASE)).replace(/\/$/, '');
  const apply = rest.includes('--apply');

  if (command === 'completion') {
    if (!args[0]) throw new Error('completion requires a learner id');
    print(await requestJson(fetchImpl, base, `/learners/${encodeURIComponent(args[0])}/completion`), stdout);
    return 0;
  }
  if (command === 'status') {
    if (!args[0]) throw new Error('status requires a learner id');
    print(await snapshot(fetchImpl, base, args[0]), stdout);
    return 0;
  }
  if (command === 'monitor') {
    if (!args.length) throw new Error('monitor requires at least one learner id');
    const intervalSeconds = Math.max(5, Number(option(rest, '--interval', 15)) || 15);
    do {
      const rows = await Promise.all(args.map((id) => snapshot(fetchImpl, base, id)));
      print({ observedAt: new Date().toISOString(), learners: rows }, stdout);
      if (!rest.includes('--watch')) break;
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    } while (true);
    return 0;
  }

  const teacher = option(rest, '--teacher');
  if (!teacher) throw new Error('--teacher ID is required for a write');
  const pin = pinFrom(rest, env);
  let method = 'POST'; let path; let body;

  if (command === 'assign') {
    const learnerId = args[0];
    const file = option(rest, '--file');
    if (!learnerId || !file) throw new Error('assign requires learner id and --file plan.yml');
    const plan = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
    const current = await requestJson(fetchImpl, base, `/assignments/${encodeURIComponent(learnerId)}`).catch(() => null);
    method = 'PUT'; path = `/assignments/${encodeURIComponent(learnerId)}`;
    body = {
      courses: plan.courses ?? plan.enrollments ?? [], units: plan.units ?? plan.standaloneWork ?? [],
      programs: plan.programs ?? [], assignedBy: teacher, pin, baseUpdatedAt: current?.updatedAt ?? undefined,
    };
  } else if (command === 'enroll' || command === 'rematerialize') {
    const learnerId = args[0];
    const syllabusId = option(rest, '--syllabus');
    if (!learnerId || !syllabusId) throw new Error(`${command} requires learner id and --syllabus ID`);
    const current = await requestJson(fetchImpl, base, `/assignments/${encodeURIComponent(learnerId)}`).catch(() => null);
    path = `/enrollments/${encodeURIComponent(learnerId)}`;
    body = {
      syllabusId, rematerialize: command === 'rematerialize', enrolledBy: teacher, pin,
      baseUpdatedAt: current?.updatedAt ?? undefined,
    };
  } else if (command === 'abandon') {
    const sessionId = args[0];
    const learnerId = option(rest, '--learner');
    const reason = option(rest, '--reason');
    if (!sessionId || !learnerId || !reason) throw new Error('abandon requires session, --learner, and --reason');
    path = `/sessions/${encodeURIComponent(sessionId)}/abandon`;
    body = { learnerId, reason, decidedBy: teacher, pin };
  } else {
    throw new Error(`unknown school ops command: ${command}`);
  }

  if (!apply) {
    print({ dryRun: true, method, url: `${base}${path}`, body: { ...body, pin: '[from environment]' } }, stdout);
    return 0;
  }
  print(await requestJson(fetchImpl, base, path, { method, body: JSON.stringify(body) }), stdout);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  return runOps({ argv });
}
