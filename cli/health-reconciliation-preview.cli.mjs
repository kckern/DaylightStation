#!/usr/bin/env node
/** Isolated replay only: no household data, hardware subscriptions or messages.
 * --live-model sends the synthetic fixture to the configured model. All proposed
 * writes are validated against disposable real YAML stores before activation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createLogger } from '../backend/src/0_system/logging/logger.mjs';
import { YamlFoodLogDatastore } from '../backend/src/1_adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { FoodLogReview } from '../backend/src/3_applications/nutrition/FoodLogReview.mjs';
import { NutritionRepairService } from '../backend/src/3_applications/nutrition/NutritionRepairService.mjs';
import { NutritionAuditor } from '../backend/src/3_applications/agents/nutrition-auditor/NutritionAuditor.mjs';
import { MastraAdapter } from '../backend/src/1_adapters/agents/MastraAdapter.mjs';
import { AgentExecutionPolicy } from '../backend/src/3_applications/agents/framework/AgentExecutionPolicy.mjs';
import { createNutriLog } from '../backend/src/3_applications/nutribot/nutriLogRecords.mjs';
import { provisionalReview } from '../shared/contracts/nutrition/reviewLifecycle.mjs';

const logger = createLogger({ app: 'health-reconciliation-preview' });
// Keep transport exceptions from dumping request bodies or provider headers.
process.on('uncaughtException', error => {
  logger.error('nutrition.preview.failed', { error: error.message });
  process.exitCode = 1;
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-reconciliation-preview-'));
const dataService = { user: { resolveDir: (relative, userId) => path.join(root, userId, relative) } };
const clock = { now: () => Date.parse('2026-09-05T22:00:00Z') };
const timezoneFor = () => 'America/Los_Angeles';
const foodLogs = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger });
const items = new YamlNutriListDatastore({ dataService, logger });
const review = new FoodLogReview({ foodLogs, items, logger, clock });
const fixture = [
  { label: 'Oikos plain yogurt', calories: 160, protein: 25, carbs: 6, fat: 3.5, grams: null, amount: 1, unit: 'serving',
    source: 'upc', upc: 'fixture-yogurt', captureEvidence: { source: 'upc', assumption: 'one-serving' } },
  { label: 'Chia seeds', calories: 70, protein: 3, carbs: 4.5, fat: 4, grams: 14, amount: 14, unit: 'g',
    source: 'upc', upc: 'fixture-chia', captureEvidence: { source: 'upc', assumption: 'one-serving' } },
  { label: 'Mixed', calories: 641, grams: 458, amount: 458, unit: 'g', source: 'scale',
    captureEvidence: { source: 'scale', grossGrams: 458, tareGrams: null, kcalPer100g: 140,
      weightBasis: 'gross-assumed-net', assumptions: ['Container tare unknown; reading provisionally treated as net.'] } },
];
for (const [index, row] of fixture.entries()) {
  const started = clock.now() - (index === 2 ? 60000 : 100 * 60000 - index * 4000);
  const log = createNutriLog({ userId: 'fixture', timezone: timezoneFor(), timestamp: new Date(started),
    meal: { date: '2026-09-05', time: 'afternoon' }, metadata: { source: row.source, sourceUpc: row.upc, captureEvidence: row.captureEvidence,
      nutritionLookup: row.upc ? { source: 'fixture', missing: ['sugar', 'sodium', 'cholesterol'], warnings: ['Partial label'] } : undefined },
    items: [{ protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null,
      ...row, ...provisionalReview({}, started, row.source), icon: 'default', color: 'yellow' }] });
  await foodLogs.save(log); await review.capture({ userId: 'fixture', logUuid: log.id });
}
const rows = await items.findByDate('fixture', '2026-09-05');
assert.equal(rows.length, 3);
assert.deepEqual(rows.map(row => row.calories), [160, 70, 641]);
const icons = { search: () => [], foodNames: () => ({}), has: slug => slug === 'default' };
const runtime = new MastraAdapter({ model: process.env.NUTRITION_PREVIEW_MODEL || 'openai/gpt-4o', logger,
  maxToolCalls: 20, executionPolicy: new AgentExecutionPolicy({ logger, maxToolCalls: 20 }) });
const auditor = new NutritionAuditor({ runtime, items, foodLogs, clock, timezoneFor, icons,
  catalog: { search: async () => [], getRecent: async () => [] }, meals: { list: async () => [] },
  upc: { lookup: async code => ({ name: code === 'fixture-yogurt' ? 'Oikos plain yogurt' : 'Chia seeds',
    serving: { size: code === 'fixture-yogurt' ? 170 : 14, unit: 'g' },
    nutrition: code === 'fixture-yogurt' ? { calories: 160, protein: 25, carbs: 6, fat: 3.5, sugar: 4, sodium: 60, cholesterol: 30 }
      : { calories: 70, protein: 3, carbs: 4.5, fat: 4, fiber: 5.1 },
    nutritionLookup: { source: 'sanitized-fixture', servingVerified: true, conflicts: [], warnings: [], missing: [] } }) } });
const repairs = new NutritionRepairService({ items, foodLogs, review, clock, timezoneFor, icons });
if (process.argv.includes('--live-model')) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for a live model preview');
  const result = await auditor.audit({}, { userId: 'fixture', runId: 'incident-preview' });
  logger.info('nutrition.preview.proposed', { summary: result.summary, repairs: result.repairs, questions: result.questions });
  const evidence = new Map(result.evidence.map(source => [source.id, source]));
  const outcomes = [];
  for (const [index, proposal] of result.repairs.entries()) {
    const sources = proposal.evidenceIds.map(id => evidence.get(id)).filter(Boolean);
    assert.equal(sources.length, proposal.evidenceIds.length, 'Every proposal must cite real evidence');
    const input = { userId: 'fixture', operationId: `preview_${index}`, proposal, evidence: sources };
    await repairs.apply({ ...input, dryRun: true });
    outcomes.push(await repairs.apply(input));
    const beforeRetry = JSON.stringify(await items.findByDate('fixture', '2026-09-05'));
    await repairs.apply(input);
    assert.equal(JSON.stringify(await items.findByDate('fixture', '2026-09-05')), beforeRetry, 'A replay cannot repeat a repair');
  }
  const after = await items.findByDate('fixture', '2026-09-05');
  assert.equal(after.filter(row => row.kind !== 'group').length, 3);
  assert.equal(result.questions.length, 0, 'Ordinary provisional assumptions must not become questions');
  logger.info('nutrition.preview.completed', { root, summary: result.summary, proposals: result.repairs,
    questions: result.questions, affectedIds: outcomes.flatMap(outcome => outcome.affectedIds || []),
    rows: after.map(row => ({ name: row.name, grams: row.grams, calories: row.calories, review: row.review })) });
} else logger.info('nutrition.preview.fixture_ready', { root, entries: rows.length, calories: rows.map(row => row.calories) });
