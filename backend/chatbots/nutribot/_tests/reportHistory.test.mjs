/**
 * Test report history data loading
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Initialize process.env.path for io.mjs compatibility
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '../../../..');
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(baseDir);

import { NutriListRepository } from '../repositories/NutriListRepository.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { UserResolver } from '../../_lib/users/UserResolver.mjs';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

const logger = createLogger({ source: 'test', app: 'nutribot' });

// Load actual config
const appConfig = yaml.load(fs.readFileSync('config.app.yml', 'utf8'));
const chatbotsConfig = appConfig.chatbots || {};

// Create UserResolver
const userResolver = new UserResolver(chatbotsConfig, { logger });

// Mock config with path getter matching api.mjs setup
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

async function testHistoryData() {
  const repo = new NutriListRepository({ config: mockConfig, logger });
  
  const userId = 'kckern';
  const today = '2025-12-16';
  
  console.log('\n=== Testing History Data Loading ===\n');
  console.log(`Data path: ${process.env.path?.data}`);
  console.log(`Config basePath: ${basePath}`);
  console.log(`User path: ${mockConfig.getNutrilistPath(userId)}`);
  console.log(`Today: ${today}`);
  console.log('Checking last 7 days...\n');
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    try {
      const items = await repo.findByDate(userId, dateStr);
      const totalCalories = items.reduce((sum, item) => sum + (item.calories || 0), 0);
      const totalGrams = items.reduce((sum, item) => sum + (item.grams || item.amount || 0), 0);
      
      console.log(`${dateStr}: ${items.length} items, ${totalCalories} cal, ${totalGrams}g`);
      
      if (items.length > 0) {
        console.log(`  Sample items: ${items.slice(0, 3).map(i => i.name || i.item || 'Unknown').join(', ')}`);
      }
    } catch (e) {
      console.log(`${dateStr}: ERROR - ${e.message}`);
      console.log(`  Stack: ${e.stack?.split('\n')[1]}`);
    }
  }
  
  console.log('\n=== Test Complete ===\n');
}

testHistoryData().catch(console.error);
