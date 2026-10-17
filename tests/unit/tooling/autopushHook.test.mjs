import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.githooks');
// Hermetic git: no user/system config, no FKB password file.
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SECRET_GUARD_AUTH_FILE: '/nonexistent' };

const git = (cwd, ...args) => spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (work, name, body = name) => {
  writeFileSync(path.join(work, name), `${body}\n`);
  ok(work, 'add', name);
  return git(work, 'commit', '-q', '-m', name);
};

let root, origin, work;

function clone(dir, { hooks } = {}) {
  ok(root, 'clone', '-q', origin, dir);
  ok(dir, 'config', 'user.name', 'Test');
  ok(dir, 'config', 'user.email', 'test@example.com');
  if (hooks) ok(dir, 'config', 'core.hooksPath', hooks);
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autopush-'));
  const hooks = path.join(root, 'hooks');
  mkdirSync(hooks);
  for (const f of ['post-commit', 'post-merge', 'pre-push', 'lib']) symlinkSync(path.join(HOOKS, f), path.join(hooks, f));

  origin = path.join(root, 'origin.git');
  ok(root, 'init', '-q', '--bare', origin);
  ok(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');

  work = clone(path.join(root, 'work'), { hooks });
  ok(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(path.join(work, '.claude'));
  writeFileSync(path.join(work, '.claude/secret-patterns.local.txt'), 'zebrafish\n');
  appendFileSync(path.join(work, '.git/info/exclude'), '.claude/\n');
  commit(work, 'seed.txt');
  ok(work, 'push', '-q', '-u', 'origin', 'main');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const remoteMain = () => ok(origin, 'rev-parse', 'main');
const head = () => ok(work, 'rev-parse', 'HEAD');
const log = () => path.join(work, '.git/autopush.log');
const optIn = () => ok(work, 'config', 'daylight.autoPush', 'true');

describe('autopush hook', { timeout: 20000 }, () => {
  it('does nothing without the opt-in', () => {
    const before = remoteMain();
    expect(commit(work, 'a.txt').status).toBe(0);
    expect(remoteMain()).toBe(before);
  });

  it('does nothing on a feature branch', () => {
    optIn();
    const before = remoteMain();
    ok(work, 'checkout', '-q', '-b', 'feat');
    expect(commit(work, 'a.txt').status).toBe(0);
    expect(remoteMain()).toBe(before);
  });

  it('pushes main after a commit', () => {
    optIn();
    expect(commit(work, 'a.txt').status).toBe(0);
    expect(remoteMain()).toBe(head());
  });

  it('pushes main after a merge', () => {
    optIn();
    ok(work, 'checkout', '-q', '-b', 'feat');
    commit(work, 'a.txt');
    ok(work, 'checkout', '-q', 'main');
    ok(work, 'merge', '-q', '--no-ff', 'feat', '-m', 'Merge feat');
    expect(remoteMain()).toBe(head());
  });

  it('does not push after a fast-forward pull', () => {
    optIn();
    const other = clone(path.join(root, 'other'));
    commit(other, 'b.txt');
    ok(other, 'push', '-q', 'origin', 'main');
    const r = git(work, 'pull', '-q', '--ff-only');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('AUTO-PUSH');
    expect(head()).toBe(remoteMain());
    expect(existsSync(log())).toBe(false);
  });

  it('keeps the commit and explains when origin moved ahead', () => {
    optIn();
    const other = clone(path.join(root, 'other'));
    commit(other, 'b.txt');
    ok(other, 'push', '-q', 'origin', 'main');
    const before = remoteMain();
    const r = commit(work, 'a.txt');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('AUTO-PUSH FAILED');
    expect(r.stderr).toContain('git pull --no-rebase origin main');
    expect(remoteMain()).toBe(before);
    expect(readFileSync(log(), 'utf8')).toContain('rejected');
  });

  it('keeps the commit and names the pattern when the scan blocks', () => {
    optIn();
    const before = remoteMain();
    const r = commit(work, 'a.txt', 'hello zebrafish');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('AUTO-PUSH FAILED');
    expect(r.stderr).toContain('zebrafish');
    expect(remoteMain()).toBe(before);
    expect(readFileSync(log(), 'utf8')).toContain('pre-push');
  });
});
