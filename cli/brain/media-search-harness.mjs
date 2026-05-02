#!/usr/bin/env node
/**
 * Media Search Harness
 *
 * Runs a battery of voice play_media scenarios against the live brain endpoint
 * and writes a JSON report. Each scenario is a single user phrase; the
 * harness sends it as if from a real satellite, captures the tool result,
 * and (optionally) asks an LLM judge whether the chosen item matches intent.
 *
 * Usage:
 *   node cli/brain/media-search-harness.mjs                     # default scenarios + endpoint
 *   node cli/brain/media-search-harness.mjs --scenarios <path>  # custom YAML
 *   node cli/brain/media-search-harness.mjs --endpoint <url>    # default http://localhost:3111
 *   node cli/brain/media-search-harness.mjs --token <bearer>    # default $DAYLIGHT_BRAIN_TOKEN_DEV
 *
 * Output:
 *   media/logs/brain-eval/<ISO>.json   (machine-readable report)
 *   stdout                              (terse per-scenario PASS/FAIL summary)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import yaml from 'js-yaml';

const args = parseArgs(process.argv.slice(2));
const ENDPOINT = args.endpoint || process.env.DAYLIGHT_BRAIN_ENDPOINT || 'http://localhost:3111';
const TOKEN    = args.token    || process.env.DAYLIGHT_BRAIN_TOKEN_DEV;
const SCENARIO_PATH = args.scenarios || resolveScenarioPath();
const REPORT_DIR = args.reportDir
  || process.env.DAYLIGHT_BRAIN_EVAL_DIR
  || resolveReportDir();

if (!TOKEN) {
  console.error('error: bearer token not set. Provide --token or set DAYLIGHT_BRAIN_TOKEN_DEV.');
  process.exit(1);
}
if (!existsSync(SCENARIO_PATH)) {
  console.error(`error: scenarios file not found at ${SCENARIO_PATH}`);
  process.exit(1);
}

const scenarios = loadScenarios(SCENARIO_PATH);
console.error(`harness: loaded ${scenarios.length} scenarios from ${SCENARIO_PATH}`);
console.error(`harness: endpoint ${ENDPOINT}`);

const results = [];
const startedAt = new Date();

for (const scenario of scenarios) {
  const turnStart = Date.now();
  const response = await callBrain(scenario.user, { endpoint: ENDPOINT, token: TOKEN });
  const elapsedMs = Date.now() - turnStart;
  const evaluation = evaluateScenario(scenario, response);
  const result = {
    name: scenario.name,
    user: scenario.user,
    expect: scenario.expect ?? null,
    response: {
      content: response.content,
      toolInvocations: response.toolInvocations,
      status: response.status,
      error: response.error,
    },
    evaluation,
    elapsedMs,
  };
  results.push(result);
  const flag = evaluation.pass ? 'PASS' : (evaluation.pass === false ? 'FAIL' : 'INFO');
  console.log(`[${flag}] ${scenario.name.padEnd(40)} ${elapsedMs}ms  ${evaluation.summary}`);
}

const summary = summarise(results);
const report = {
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  scenarioPath: SCENARIO_PATH,
  totalMs: Date.now() - startedAt.getTime(),
  summary,
  results,
};

mkdirSync(REPORT_DIR, { recursive: true });
const reportFile = join(REPORT_DIR, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 2));

console.log('');
console.log(`pass: ${summary.passed} / ${summary.total}  (fail: ${summary.failed}, info: ${summary.info})`);
console.log(`report: ${reportFile}`);

process.exit(summary.failed > 0 ? 1 : 0);

// ─── helpers ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenarios') out.scenarios = argv[++i];
    else if (a === '--endpoint') out.endpoint = argv[++i];
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--report-dir') out.reportDir = argv[++i];
  }
  return out;
}

function resolveScenarioPath() {
  // Prefer a user-curated file in the data volume; fall back to the example shipped in repo.
  const candidates = [
    process.env.DAYLIGHT_BASE_PATH && join(process.env.DAYLIGHT_BASE_PATH, 'data/household/eval/media-scenarios.yml'),
    '/usr/src/app/data/household/eval/media-scenarios.yml',
    join(process.cwd(), 'data/household/eval/media-scenarios.yml'),
    join(process.cwd(), 'cli/brain/media-scenarios.example.yml'),
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1];
}

function resolveReportDir() {
  if (process.env.DAYLIGHT_BASE_PATH) {
    return join(process.env.DAYLIGHT_BASE_PATH, 'media/logs/brain-eval');
  }
  return join(process.cwd(), 'media/logs/brain-eval');
}

function loadScenarios(path) {
  const raw = readFileSync(path, 'utf8');
  const doc = yaml.load(raw) ?? {};
  const list = doc.scenarios ?? [];
  if (!Array.isArray(list)) throw new Error('scenarios YAML must have a top-level "scenarios:" array');
  return list.filter(s => s && s.user).map((s, i) => ({
    name: s.name || `scenario-${i + 1}`,
    user: s.user,
    expect: s.expect ?? null,
  }));
}

async function callBrain(userMessage, { endpoint, token }) {
  // Send a single-turn non-streaming chat completion. The translator returns
  // the full envelope including any tool invocations our backend captured.
  // We rely on the Brain transcript log file for tool-invocation detail; here
  // we derive what we can from the chat envelope alone.
  try {
    const r = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'daylight-house',
        stream: false,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      return { status: r.status, error: text.slice(0, 500), content: '', toolInvocations: [] };
    }
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    const content = body?.choices?.[0]?.message?.content ?? '';
    const toolCalls = body?.choices?.[0]?.message?.tool_calls ?? [];
    return {
      status: r.status,
      content,
      toolInvocations: toolCalls,
      error: null,
    };
  } catch (err) {
    return { status: 0, content: '', toolInvocations: [], error: err.message };
  }
}

function evaluateScenario(scenario, response) {
  const expect = scenario.expect ?? {};
  // No declared expectation — informational only.
  if (!expect || Object.keys(expect).length === 0) {
    return { pass: null, summary: '(no expect block)' };
  }

  // expect.tool_called: 'play_media' — true if any tool_call name matches
  if (expect.tool_called) {
    const found = response.toolInvocations?.some(t => t?.payload?.toolName === expect.tool_called || t?.toolName === expect.tool_called);
    if (!found) return { pass: false, summary: `expected tool ${expect.tool_called} not invoked` };
  }
  // expect.no_match: true — model should refuse politely
  if (expect.no_match) {
    const refusedish = /can'?t find|couldn'?t find|don'?t have|no.*results/i.test(response.content);
    if (!refusedish) return { pass: false, summary: 'expected polite no-match refusal' };
  }
  // expect.contains: substring of response content (or empty for tool-call only)
  if (expect.contains) {
    if (!response.content?.toLowerCase().includes(String(expect.contains).toLowerCase())) {
      return { pass: false, summary: `response missing "${expect.contains}"` };
    }
  }
  // expect.status: HTTP status (default 200)
  if (expect.status && response.status !== expect.status) {
    return { pass: false, summary: `status ${response.status} ≠ ${expect.status}` };
  }
  return { pass: true, summary: 'ok' };
}

function summarise(results) {
  return {
    total: results.length,
    passed: results.filter(r => r.evaluation.pass === true).length,
    failed: results.filter(r => r.evaluation.pass === false).length,
    info:   results.filter(r => r.evaluation.pass === null).length,
  };
}
