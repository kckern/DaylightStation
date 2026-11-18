// Runs realistic phrases through the real decision gateway and scores how
// DayInstructionReader reads them. Makes paid Jev calls; writes no food data.
// Usage: DAYLIGHT_BASE_PATH=<content-base> node day-instruction-calibrate.mjs
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

async function main() {
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) throw new Error('DAYLIGHT_BASE_PATH is required');
  const auth = yaml.load(fs.readFileSync(path.join(base, 'data/system/auth/jev.yml'), 'utf8'));
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const aiUsageLedger = createAiUsageLedger({ dir: path.join(base, 'data/system/history/ai-usage'), source: 'day-instruction-calibration', logger });
  const gateway = new JevAdapter({ apiKey: auth.api_key }, { httpClient: axios, logger, aiUsageLedger }).scoped({ app: 'health', feature: 'day-instruction-calibration' });
  const reader = new DayInstructionReader({ decisionGateway: gateway });
  const cases = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/day-instruction-calibration.json', import.meta.url)), 'utf8'));

  let wrong = 0;
  for (const item of cases) {
    let detail;
    try {
      const plan = await reader.read({ text: item.text, date: TODAY, today: TODAY, foods: FOODS, latest: LATEST });
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

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
