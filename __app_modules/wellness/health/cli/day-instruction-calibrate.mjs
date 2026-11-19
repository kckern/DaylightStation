#!/usr/bin/env node
// Runs realistic phrases through the real decision gateway and scores how
// DayInstructionReader reads them. Makes paid Jev calls; writes no food data.
// Usage: DAYLIGHT_BASE_PATH=<content-base> node cli/day-instruction-calibrate.mjs [--only id,id]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import axios from 'axios';
import { JevAdapter } from '#adapters/ai/JevAdapter.mjs';
import { createAiUsageLedger } from '#adapters/ai/AiUsageLedger.mjs';
import { DayInstructionReader } from '../server/application/health/DayInstructionReader.mjs';

const FIELDS = ['intent', 'target', 'fromMeal', 'toDay', 'toMeal', 'compound'];
const TODAY = '2026-11-18';
const FOODS = ['Oatmeal', 'Iced tea', 'Rice', 'Chicken', 'Whole wheat toast', 'Coffee'];
const LATEST = ['Iced tea', 'Rice'];

// YAML parse errors quote the source, which here holds the API key, so the
// original error must never surface.
export function readJevApiKey(base) {
  let apiKey;
  try {
    apiKey = yaml.load(fs.readFileSync(path.join(base, 'data/system/auth/jev.yml'), 'utf8'))?.api_key;
  } catch {
    apiKey = null;
  }
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('Unreadable system/auth/jev.yml');
  return apiKey;
}

/** What the reader is given for one case. A case may describe its own day. */
export const readingInput = item => ({ text: item.text, date: TODAY, today: TODAY, foods: item.foods ?? FOODS, latest: item.latest ?? LATEST, latestDate: item.latestDate });

/** Every case, or those named by `--only`, which costs one paid call each. */
export function selectCases(cases, args) {
  const flag = args.indexOf('--only');
  if (flag === -1) return cases;
  const ids = (args[flag + 1] || '').split(',').filter(Boolean);
  if (!ids.length) throw new Error('--only needs case IDs');
  const unknown = ids.find(id => !cases.some(item => item.id === id));
  if (unknown) throw new Error(`Unknown calibration case: ${unknown}`);
  return cases.filter(item => ids.includes(item.id));
}

export async function main() {
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) throw new Error('DAYLIGHT_BASE_PATH is required');
  const apiKey = readJevApiKey(base);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const aiUsageLedger = createAiUsageLedger({ dir: path.join(base, 'data/system/history/ai-usage'), source: 'day-instruction-calibration', logger });
  const gateway = new JevAdapter({ apiKey }, { httpClient: axios, logger, aiUsageLedger }).scoped({ app: 'health', feature: 'day-instruction-calibration' });
  const reader = new DayInstructionReader({ decisionGateway: gateway });
  const cases = selectCases(JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/day-instruction-calibration.json', import.meta.url)), 'utf8')), process.argv.slice(2));

  let wrong = 0;
  for (const item of cases) {
    let detail;
    try {
      const plan = await reader.read(readingInput(item));
      detail = FIELDS
        .filter(key => item[key] !== undefined && item[key] !== plan[key])
        .map(key => `${key}=${plan[key]} (expected ${item[key]})`)
        .join(' ');
    } catch (error) {
      // An unreadable answer is a failed case, and the other cases still run.
      detail = `error: ${error.message}`;
    }
    if (detail) wrong += 1;
    process.stdout.write(`${detail ? 'MISS' : 'ok  '} ${item.id}${detail ? ` ${detail}` : ''}\n`);
  }
  process.stdout.write(`${cases.length - wrong}/${cases.length} correct\n`);
  process.exitCode = wrong ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { runCliEntry(); }

/** Stable command launcher entry. */
export function runCliEntry() {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
