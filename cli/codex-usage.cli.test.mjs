import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { evaluateWeekly, runCli } from './codex-usage.cli.mjs';

const future = '2030-01-08T00:00:00.000Z';
const entrypoint = fileURLToPath(new URL('./codex-usage.cli.mjs', import.meta.url));
const weekly = (used, place = 'primary') => ({
  limitId: 'codex', rateLimits: { [place]: { windowDurationMins: 10080, usedPercent: used, resetsAt: future } }
});

function fakeSpawn(messages, { neverRespond = false, error, partial = false } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); return true; };
    child.stdin.on('data', (chunk) => {
      if (neverRespond || error) return;
      const request = JSON.parse(String(chunk));
      if (request.method === 'initialize') child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} })}\n`);
      if (request.method === 'account/rateLimits/read') {
        for (const message of messages) {
          const line = `${JSON.stringify(message)}\n`;
          if (partial) { child.stdout.write(line.slice(0, 7)); child.stdout.write(line.slice(7)); } else child.stdout.write(line);
        }
        child.end();
      }
    });
    if (error) queueMicrotask(() => child.emit('error', new Error(error)));
    return child;
  };
}

test('runs the CLI when invoked through a symlink', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'codex-usage-'));
  const symlink = path.join(directory, 'codex-usage');
  try {
    symlinkSync(entrypoint, symlink);
    const result = spawnSync(process.execPath, [symlink, 'bogus', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 3);
    assert.ok(result.stdout.trim());
    assert.equal(JSON.parse(result.stdout).decision, 'STOP');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function check(rateLimits, options = {}) {
  const lines = [];
  const exitCode = await runCli({ args: ['check', '--json'], spawnImpl: fakeSpawn([
    { jsonrpc: '2.0', id: 2, result: { rateLimitsByLimitId: { codex: rateLimits } } }
  ], options), timeoutMs: 30, write: (line) => lines.push(line), now: () => Date.parse('2030-01-01T00:00:00.000Z') });
  return { exitCode, body: JSON.parse(lines.join('')) };
}

test('authorized weekly boundaries', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  for (const value of [25, 27, 29, 31, 33]) {
    assert.equal(evaluateWeekly(weekly(value), now).decision, 'OK');
  }
  assert.equal(evaluateWeekly(weekly(48), now).decision, 'WARNING');
  assert.equal(evaluateWeekly(weekly(49.99), now).decision, 'WARNING');
  assert.equal(evaluateWeekly(weekly(50), now).decision, 'STOP');
  assert.equal(evaluateWeekly(weekly(100), now).decision, 'STOP');
});

test('reports WARNING at the 48% weekly threshold', async () => {
  const result = await check(weekly(48));
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.decision, 'WARNING');
  assert.equal(result.body.weeklyUsedPercent, 48);
  assert.deepEqual(result.body.policyThresholds, { warningPercent: 48, hardStopPercent: 50 });
});

test('stops at the inclusive 50% weekly hard limit', async () => {
  const result = await check(weekly(50));
  assert.equal(result.exitCode, 2);
  assert.equal(result.body.decision, 'STOP');
});

test('uses a matching secondary weekly window conservatively', async () => {
  const result = await check({ rateLimits: { primary: { windowDurationMins: 60, usedPercent: 2, resetsAt: future }, secondary: { windowDurationMins: 10080, usedPercent: 33, resetsAt: future } } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.weeklyUsedPercent, 33);
  assert.equal(result.body.decision, 'OK');
});

for (const [name, item] of [
  ['missing weekly window', { rateLimits: { primary: { windowDurationMins: 60, usedPercent: 2, resetsAt: future } } }],
  ['NaN percentage', weekly('NaN')],
  ['negative percentage', weekly(-1)],
  ['percentage above 100', weekly(101)],
  ['expired reset', { ...weekly(2), rateLimits: { primary: { windowDurationMins: 10080, usedPercent: 2, resetsAt: '2029-01-01T00:00:00.000Z' } } }],
]) test(`stops unavailable for ${name}`, async () => {
  const result = await check(item);
  assert.equal(result.exitCode, 3);
  assert.equal(result.body.decision, 'STOP');
});

test('stops when an upstream reached flag is explicit', async () => {
  const result = await check({ ...weekly(3), spendControlReached: true });
  assert.equal(result.exitCode, 2);
  assert.equal(result.body.decision, 'STOP');
});

test('accepts a JSON-RPC response split across stdout chunks', async () => {
  const result = await check(weekly(3), { partial: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.decision, 'OK');
});

test('status keeps a gate decision when optional usage is unavailable', { timeout: 50 }, async () => {
  const lines = [];
  const exitCode = await runCli({ args: ['status', '--json'], spawnImpl: fakeSpawn([
    { jsonrpc: '2.0', id: 2, result: { rateLimitsByLimitId: { codex: weekly(3) } } }
  ]), timeoutMs: 5, write: (line) => lines.push(line), now: () => Date.parse('2030-01-01T00:00:00.000Z') });
  const body = JSON.parse(lines.join(''));
  assert.equal(exitCode, 0);
  assert.equal(body.decision, 'OK');
  assert.equal(body.usageSummary, 'unavailable');
  assert.doesNotMatch(lines.join(''), /account[_-]?id|secret/i);
});

test('reports timeout without raw server error details', async () => {
  const lines = [];
  const exitCode = await runCli({ args: ['check', '--json'], spawnImpl: fakeSpawn([], { neverRespond: true }), timeoutMs: 5, write: (line) => lines.push(line) });
  assert.equal(exitCode, 3);
  assert.match(lines.join(''), /unavailable/i);
  assert.doesNotMatch(lines.join(''), /secret|auth|token/i);
});

test('reports spawn failure safely', async () => {
  const lines = [];
  const exitCode = await runCli({ args: ['check', '--json'], spawnImpl: fakeSpawn([], { error: 'secret token leaked' }), timeoutMs: 30, write: (line) => lines.push(line) });
  assert.equal(exitCode, 3);
  assert.doesNotMatch(lines.join(''), /secret token leaked/);
});

test('stops safely for a valid JSON null response', async () => {
  const lines = [];
  const spawnNull = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.emit('exit', null, 'SIGTERM'); return true; };
    child.stdin.on('data', () => child.stdout.write('null\n'));
    return child;
  };
  const exitCode = await runCli({ args: ['check', '--json'], spawnImpl: spawnNull, timeoutMs: 30, write: (line) => lines.push(line) });
  assert.equal(exitCode, 3);
  const body = JSON.parse(lines.join(''));
  assert.equal(body.decision, 'STOP');
  assert.equal(body.reason, 'usage response unavailable');
});
