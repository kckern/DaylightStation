/**
 * Test report rendering with history data
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Initialize process.env.path for io.mjs compatibility
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '../../../..');
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(baseDir);

import { NutriListRepository } from '../repositories/NutriListRepository.mjs';
import { CanvasReportRenderer } from '../../adapters/http/CanvasReportRenderer.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { UserResolver } from '../../_lib/users/UserResolver.mjs';
import * as yaml from 'js-yaml';

const logger = createLogger({ source: 'test', app: 'nutribot' });

// Load actual config
const appConfig = yaml.load(await fs.readFile('config.app.yml', 'utf8'));
const chatbotsConfig = appConfig.chatbots || {};

// Create UserResolver
const userResolver = new UserResolver(chatbotsConfig, { logger });

// Mock config with path getter
const basePath = chatbotsConfig?.data?.nutribot?.basePath || 'lifelog/nutrition';
const paths = chatbotsConfig?.data?.nutribot?.paths || {
  nutrilist: '{username}/nutrilist',
};

const mockConfig = {
  getNutrilistPath: (userId) => {
    const username = userResolver.resolveUsername(userId) || userId;
    return `${basePath}/${paths.nutrilist.replace('{username}', username)}`;
  },
};

async function buildHistory(repo, userId, today) {
  const history = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    try {
      const items = await repo.findByDate(userId, dateStr);
      const calories = items.reduce((sum, item) => sum + (item.calories || 0), 0);
      const protein = items.reduce((sum, item) => sum + (item.protein || 0), 0);
      const carbs = items.reduce((sum, item) => sum + (item.carbs || 0), 0);
      const fat = items.reduce((sum, item) => sum + (item.fat || 0), 0);
      history.push({
        date: dateStr,
        calories,
        protein,
        carbs,
        fat,
        itemCount: items.length,
      });
    } catch (e) {
      history.push({ date: dateStr, calories: 0, protein: 0, carbs: 0, fat: 0, itemCount: 0 });
    }
  }
  return history;
}

async function testReportRender() {
  const repo = new NutriListRepository({ config: mockConfig, logger });
  
  const userId = 'kckern';
  const today = '2025-12-16';
  
  console.log('\n=== Testing Report Render ===\n');
  
  // Build history
  const history = await buildHistory(repo, userId, today);
  console.log('History data:');
  history.forEach(h => {
    console.log(`  ${h.date}: ${h.calories} cal, ${h.protein}p/${h.carbs}c/${h.fat}f`);
  });
  
  // Get today's items
  const items = await repo.findByDate(userId, today);
  const totals = items.reduce((acc, item) => {
    acc.calories += item.calories || 0;
    acc.protein += item.protein || 0;
    acc.carbs += item.carbs || 0;
    acc.fat += item.fat || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  
  console.log(`\nToday (${today}): ${items.length} items, ${totals.calories} cal`);
  
  const goals = { calories: 2000, protein: 150, carbs: 200, fat: 65 };
  
  // Render
  const renderer = new CanvasReportRenderer();
  const pngBuffer = await renderer.renderDailyReport({
    date: today,
    totals,
    goals,
    items,
    history,
  });
  
  // Save to temp file
  const outputPath = path.join(process.cwd(), 'tmp', `report-test-${Date.now()}.png`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, pngBuffer);
  
  console.log(`\n✅ Report generated: ${outputPath}`);
  console.log(`   Size: ${pngBuffer.length} bytes\n`);
}

testReportRender().catch(console.error);
