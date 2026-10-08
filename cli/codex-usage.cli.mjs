#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEEKLY_MINUTES = 10080;
const WARNING_PERCENT = 48;
const HARD_STOP_PERCENT = 50;
const MAX_LINE_BYTES = 65536;

function safeReason(code) {
  return ({ timeout: 'usage service unavailable', spawn: 'usage service unavailable', malformed: 'usage response unavailable', unavailable: 'weekly usage unavailable' })[code] || 'weekly usage unavailable';
}

function resetTime(value) {
  const time = typeof value === 'number' ? (value < 100000000000 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function isReached(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'spendControlReached' || key === 'reached') && child === true) return true;
    if (key === 'rateLimitReachedType' && typeof child === 'string' && child) return true;
    if ((key === 'state' || key === 'status' || key === 'spendControlState') && typeof child === 'string' && child.toLowerCase() === 'reached') return true;
    if (isReached(child, seen)) return true;
  }
  return false;
}

function selectLimit(result) {
  if (result?.rateLimitsByLimitId?.codex) return result.rateLimitsByLimitId.codex;
  const limits = result?.rateLimits;
  if (Array.isArray(limits)) return limits.find((item) => item?.limitId === 'codex' || item?.id === 'codex');
  return limits?.codex || (result?.limitId === 'codex' ? result : undefined);
}

export function evaluateWeekly(result, now = Date.now()) {
  const limit = selectLimit(result);
  if (!limit) return { decision: 'STOP', reason: safeReason('unavailable'), unavailable: true };
  const windows = [limit.primary, limit.secondary, limit.rateLimits?.primary, limit.rateLimits?.secondary]
    .filter((window) => window?.windowDurationMins === WEEKLY_MINUTES);
  if (!windows.length) return { decision: 'STOP', reason: safeReason('unavailable'), unavailable: true };
  const values = windows.map((window) => ({ used: window.usedPercent, reset: resetTime(window.resetsAt) }));
  if (values.some(({ used, reset }) => !Number.isFinite(used) || used < 0 || used > 100 || !Number.isFinite(reset) || reset <= now)) {
    return { decision: 'STOP', reason: safeReason('unavailable'), unavailable: true };
  }
  const weeklyUsedPercent = Math.max(...values.map(({ used }) => used));
  const reset = new Date(Math.min(...values.map(({ reset }) => reset))).toISOString();
  if (isReached(limit) || isReached(result)) return { decision: 'STOP', reason: 'upstream spend control reached', weeklyUsedPercent, reset };
  if (weeklyUsedPercent >= HARD_STOP_PERCENT) return { decision: 'STOP', reason: 'weekly hard limit reached', weeklyUsedPercent, reset };
  if (weeklyUsedPercent >= WARNING_PERCENT) return { decision: 'WARNING', reason: 'weekly warning reserve', weeklyUsedPercent, reset };
  return { decision: 'OK', reason: 'within weekly budget', weeklyUsedPercent, reset };
}

function openRpc({ spawnImpl, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch { reject('spawn'); return; }
    let buffer = ''; let settled = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { if (child?.kill) child.kill(); reject(error); } else resolve({ child, request }); };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const pending = new Map(); let nextId = 1;
    const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
      const id = nextId++;
      const requestTimer = setTimeout(() => {
        pending.delete(id);
        if (child?.kill) child.kill();
        rejectRequest('timeout');
      }, timeoutMs);
      pending.set(id, { resolve: (result) => { clearTimeout(requestTimer); resolveRequest(result); }, reject: (error) => { clearTimeout(requestTimer); rejectRequest(error); } });
      try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`); } catch { pending.delete(id); rejectRequest('spawn'); }
    });
    const receive = (chunk) => {
      buffer += String(chunk);
      const malformed = () => {
        if (!settled) return finish('malformed');
        for (const wait of pending.values()) wait.reject('malformed');
        pending.clear();
        if (child?.kill) child.kill();
      };
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) return malformed();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message; try { message = JSON.parse(line); } catch { return malformed(); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return malformed();
        const wait = pending.get(message.id); if (!wait) continue;
        pending.delete(message.id);
        if (message.error || !Object.hasOwn(message, 'result')) wait.reject('unavailable'); else wait.resolve(message.result);
      }
    };
    child.on('error', () => finish('spawn'));
    child.on('exit', () => { if (!settled) finish('unavailable'); });
    child.stdout.on('data', receive);
    request('initialize', { clientInfo: { name: 'daylight_usage', version: '0.1' }, capabilities: { experimentalApi: true } })
      .then(() => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`); finish(); })
      .catch((error) => finish(error));
  });
}

function compact(gate, checkedAt, usageSummary) {
  return { checkedAt, weeklyUsedPercent: gate.weeklyUsedPercent ?? null, reset: gate.reset ?? null, policyThresholds: { warningPercent: WARNING_PERCENT, hardStopPercent: HARD_STOP_PERCENT }, decision: gate.decision, reason: gate.reason, ...(usageSummary ? { usageSummary } : {}) };
}

export async function runCli({ args = process.argv.slice(2), spawnImpl = spawn, timeoutMs = 5000, write = (line) => process.stdout.write(line), now = Date.now } = {}) {
  const command = args.find((arg) => !arg.startsWith('-')) || 'status'; const json = args.includes('--json');
  if (!['status', 'check'].includes(command)) { write(json ? `${JSON.stringify({ decision: 'STOP', reason: 'invalid command' })}\n` : 'STOP: invalid command\n'); return 3; }
  let rpc; let gate;
  try { rpc = await openRpc({ spawnImpl, timeoutMs }); const rates = await rpc.request('account/rateLimits/read'); gate = evaluateWeekly(rates, now()); }
  catch (error) { gate = { decision: 'STOP', reason: safeReason(error), unavailable: true }; }
  let usageSummary;
  if (command === 'status' && rpc && !gate.unavailable) {
    try { const usage = await rpc.request('account/usage/read'); usageSummary = usage?.summary ?? usage?.daily ?? 'unavailable'; } catch { usageSummary = 'unavailable'; }
  }
  if (rpc?.child?.kill) rpc.child.kill();
  const body = compact(gate, new Date(now()).toISOString(), usageSummary);
  write(json ? `${JSON.stringify(body)}\n` : `${body.decision}: ${body.reason}${body.weeklyUsedPercent === null ? '' : ` (${body.weeklyUsedPercent}%)`}\n`);
  return gate.unavailable ? 3 : gate.decision === 'STOP' ? 2 : 0;
}

let invokedPath;
try { if (process.argv[1]) invokedPath = realpathSync(process.argv[1]); } catch {}
if (invokedPath === fileURLToPath(import.meta.url)) runCli().then((code) => { process.exitCode = code; });
