import { describe, it, expect } from '@jest/globals';
import { LayoutManager } from '../../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/layout/LayoutManager.js';
import { createPRNG, generateScenario, detectAnomalies, CHART_DEFAULTS } from './testUtils.mjs';
import fs from 'fs';
import path from 'path';

const TOTAL_SEEDS = 10000;
const BATCH_SIZE = 100;
const REPORT_DIR = path.join(process.cwd(), 'tests/runtime/chart/reports');

/**
 * Run a single simulation with the given seed.
 */
function runSimulation(seed) {
  const scenario = generateScenario(seed);

  const manager = new LayoutManager({
    bounds: {
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin: scenario.margin
    },
    avatarRadius: CHART_DEFAULTS.avatarRadius,
    badgeRadius: CHART_DEFAULTS.badgeRadius,
    trace: true
  });

  const { elements, trace } = manager.layout(scenario.elements);
  const { hasAnomaly, anomalies } = detectAnomalies(scenario.elements, elements, trace);

  return {
    seed,
    scenario: {
      userCount: scenario.userCount,
      tickCount: scenario.tickCount,
      chartWidth: scenario.chartWidth,
      clustered: scenario.clustered
    },
    hasAnomaly,
    anomalies,
    trace: hasAnomaly ? trace : undefined,
    input: hasAnomaly ? scenario.elements : undefined
  };
}

/**
 * Run batch of simulations concurrently.
 */
async function runBatch(startSeed, count) {
  const promises = Array.from({ length: count }, (_, i) => {
    return Promise.resolve(runSimulation(startSeed + i));
  });
  return Promise.all(promises);
}

describe('LayoutManager Wide-Scale Exploration', () => {
  it(`should find no anomalies across ${TOTAL_SEEDS} random seeds`, async () => {
    const allAnomalies = [];
    const batchCount = Math.ceil(TOTAL_SEEDS / BATCH_SIZE);

    for (let batch = 0; batch < batchCount; batch++) {
      const startSeed = batch * BATCH_SIZE;
      const count = Math.min(BATCH_SIZE, TOTAL_SEEDS - startSeed);

      const results = await runBatch(startSeed, count);
      const anomalous = results.filter(r => r.hasAnomaly);
      allAnomalies.push(...anomalous);

      // Progress logging every 10 batches
      if (batch % 10 === 0) {
        console.log(`Batch ${batch + 1}/${batchCount}: ${allAnomalies.length} anomalies found so far`);
      }
    }

    // Write anomaly report if any found
    if (allAnomalies.length > 0) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const reportPath = path.join(REPORT_DIR, `anomaly-${Date.now()}.json`);

      const report = {
        timestamp: new Date().toISOString(),
        totalSeeds: TOTAL_SEEDS,
        anomalyCount: allAnomalies.length,
        anomalyRate: (allAnomalies.length / TOTAL_SEEDS * 100).toFixed(4) + '%',
        anomalies: allAnomalies.map(a => ({
          seed: a.seed,
          scenario: a.scenario,
          anomalies: a.anomalies,
          replayCommand: `npm run test:unit -- --testPathPattern=layout -t "seed ${a.seed}"`
        }))
      };

      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nAnomaly report written to: ${reportPath}`);

      // Summarize by anomaly type
      const byType = {};
      allAnomalies.forEach(a => {
        a.anomalies.forEach(anomaly => {
          byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
        });
      });
      console.log('\nAnomaly types:', byType);
    }

    expect(allAnomalies.length).toBe(0);
  }, 120000); // 2 minute timeout

  // Individual seed replay tests
  describe.skip('replay specific seeds', () => {
    const failingSeeds = [];

    failingSeeds.forEach(seed => {
      it(`seed ${seed}: should not have anomalies`, () => {
        const result = runSimulation(seed);

        if (result.hasAnomaly) {
          console.log('Scenario:', result.scenario);
          console.log('Anomalies:', JSON.stringify(result.anomalies, null, 2));
          console.log('Trace:', JSON.stringify(result.trace, null, 2));
        }

        expect(result.anomalies).toEqual([]);
      });
    });
  });
});
