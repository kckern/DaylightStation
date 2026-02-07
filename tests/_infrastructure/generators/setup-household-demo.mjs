#!/usr/bin/env node
/**
 * Generates household-demo test data
 *
 * Usage:
 *   node tests/_infrastructure/generators/setup-household-demo.mjs
 *   node tests/_infrastructure/generators/setup-household-demo.mjs --seed=12345
 *
 * Options:
 *   --seed=<number>  Set random seed for reproducible generation
 *   --days=<number>  Number of days of data to generate (default: 90)
 *   --clean          Remove existing data before generating
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import utilities and generators
import {
  USERS,
  setSeed,
  today,
  subDays,
  formatDate,
  ensureDir,
  writeYaml,
  removeDir,
} from './utils.mjs';

import {
  generateFitnessConfig,
  generateSessionsForRange,
  generateUserFitnessProfile,
  generateFitnessLifelog,
} from './fitness.generator.mjs';

import {
  generateBudgetConfig,
  generateAccountBalances,
  generateTransactionsForRange,
  groupTransactionsByMonth,
} from './finance.generator.mjs';

import {
  generateCalendarEvents,
  generateSharedEvents,
} from './calendar.generator.mjs';

import {
  generateNutritionLogs,
  generateUserNutrilog,
  groupLogsByMonth,
  generateNutrichart,
} from './nutrition.generator.mjs';

import {
  generateWatchlist,
  generateWatchHistory,
  generateMediaMenu,
  generatePlaylists,
  generateGratitudeEntries,
} from './media.generator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../household-demo');

// Parse command line arguments
function parseArgs() {
  const args = {
    seed: Date.now(),
    days: 90,
    clean: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--seed=')) {
      args.seed = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--days=')) {
      args.days = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--clean') {
      args.clean = true;
    }
  }

  return args;
}

/**
 * Generate household configuration
 */
function generateHouseholdConfig() {
  return {
    version: '1.0',
    household_id: 'demo',
    name: 'Demo Household',
    head: 'popeye',
    members: USERS.map(u => u.id),
    timezone: 'America/Los_Angeles',
    apps: {
      fitness: {
        primary_users: ['popeye', 'tintin', 'mickey'],
      },
    },
  };
}

/**
 * Generate user profile
 */
function generateUserProfile(user) {
  return {
    version: '1.0',
    username: user.id,
    household_id: 'demo',
    display_name: user.name,
    birthyear: user.birthyear,
    type: user.persona === 'guest' ? 'guest' : 'family_member',
    group: ['popeye', 'tintin', 'mickey'].includes(user.id) ? 'primary' : 'secondary',
    apps: {
      fitness: {
        heart_rate_zones: {
          active: Math.round(user.fitness.resting_hr + (user.fitness.max_hr - user.fitness.resting_hr) * 0.5),
          warm: Math.round(user.fitness.resting_hr + (user.fitness.max_hr - user.fitness.resting_hr) * 0.6),
          hot: Math.round(user.fitness.resting_hr + (user.fitness.max_hr - user.fitness.resting_hr) * 0.7),
          fire: Math.round(user.fitness.resting_hr + (user.fitness.max_hr - user.fitness.resting_hr) * 0.85),
        },
      },
    },
  };
}

/**
 * Generate integrations config
 */
function generateIntegrationsConfig() {
  return {
    plex: {
      service: 'plex',
      port: 32400,
      protocol: 'dash',
      platform: 'Chrome',
    },
    homeassistant: {
      service: 'homeassistant',
      port: 8123,
    },
  };
}

/**
 * Generate devices config
 */
function generateDevicesConfig() {
  return {
    devices: {
      'demo-tv': {
        type: 'demo-device',
        device_control: {
          displays: {
            main: {
              provider: 'mock',
            },
          },
        },
      },
    },
  };
}

/**
 * Generate chatbots identity mappings
 */
function generateChatbotsConfig() {
  return {
    identity_mappings: {
      telegram: USERS.reduce((acc, user, idx) => {
        acc[String(100000000 + idx)] = user.id;
        return acc;
      }, {}),
    },
  };
}

/**
 * Main generation function
 */
async function main() {
  const args = parseArgs();
  console.log('Generating household-demo test data...');
  console.log(`  Seed: ${args.seed}`);
  console.log(`  Days: ${args.days}`);
  console.log(`  Output: ${OUTPUT_DIR}`);

  // Set random seed for reproducibility
  setSeed(args.seed);

  // Clean output directory if requested
  if (args.clean) {
    console.log('\nCleaning existing data...');
    removeDir(OUTPUT_DIR);
  }

  // Calculate date ranges
  const endDate = today();
  const startDate = subDays(endDate, args.days - 1);
  console.log(`\nDate range: ${formatDate(startDate)} to ${formatDate(endDate)}`);

  // ============== Create directory structure ==============
  console.log('\nCreating directory structure...');
  ensureDir(OUTPUT_DIR);
  ensureDir(path.join(OUTPUT_DIR, 'history/fitness/sessions'));
  ensureDir(path.join(OUTPUT_DIR, 'apps/finances'));
  ensureDir(path.join(OUTPUT_DIR, 'apps/nutribot'));
  ensureDir(path.join(OUTPUT_DIR, 'shared/gratitude'));
  ensureDir(path.join(OUTPUT_DIR, 'state'));
  ensureDir(path.join(OUTPUT_DIR, 'history'));
  ensureDir(path.join(OUTPUT_DIR, 'users'));

  // Create user directories
  for (const user of USERS) {
    ensureDir(path.join(OUTPUT_DIR, 'users', user.id, 'lifelog/nutrition/archives/nutrilog'));
    ensureDir(path.join(OUTPUT_DIR, 'users', user.id, 'lifelog'));
  }

  // ============== Generate core config files ==============
  console.log('\nGenerating core configuration...');

  // Create config subdirectory
  const configDir = path.join(OUTPUT_DIR, 'config');
  ensureDir(configDir);

  // Household config
  writeYaml(path.join(configDir, 'household.yml'), generateHouseholdConfig());
  console.log('  ✓ config/household.yml');

  // Integrations config
  writeYaml(path.join(configDir, 'integrations.yml'), generateIntegrationsConfig());
  console.log('  ✓ config/integrations.yml');

  // Devices config
  writeYaml(path.join(configDir, 'devices.yml'), generateDevicesConfig());
  console.log('  ✓ config/devices.yml');

  // User profiles
  for (const user of USERS) {
    writeYaml(path.join(OUTPUT_DIR, 'users', user.id, 'profile.yml'), generateUserProfile(user));
  }
  console.log(`  ✓ ${USERS.length} user profiles`);

  // ============== Generate fitness data ==============
  console.log('\nGenerating fitness data...');

  // Fitness config
  const fitnessConfig = generateFitnessConfig();
  writeYaml(path.join(OUTPUT_DIR, 'apps/fitness/config.yml'), fitnessConfig);
  console.log('  ✓ apps/fitness/config.yml');

  // Fitness sessions
  const sessions = generateSessionsForRange(startDate, args.days, USERS);
  let sessionCount = 0;
  for (const [dateStr, daySessions] of Object.entries(sessions)) {
    const dateDir = path.join(OUTPUT_DIR, 'history/fitness/sessions', dateStr);
    ensureDir(dateDir);
    for (const session of daySessions) {
      const filename = `${session.id}.yml`;
      writeYaml(path.join(dateDir, filename), session);
      sessionCount++;
    }
  }
  console.log(`  ✓ ${sessionCount} fitness sessions`);

  // User fitness lifelogs
  for (const user of USERS) {
    const lifelog = generateFitnessLifelog(user.id, sessions);
    writeYaml(path.join(OUTPUT_DIR, 'users', user.id, 'lifelog/fitness.yml'), lifelog);
  }
  console.log(`  ✓ ${USERS.length} fitness lifelogs`);

  // ============== Generate finance data ==============
  console.log('\nGenerating finance data...');

  // Budget config
  const budgetConfig = generateBudgetConfig();
  writeYaml(path.join(OUTPUT_DIR, 'apps/finances/budget.config.yml'), budgetConfig);
  console.log('  ✓ apps/finances/budget.config.yml');

  // Account balances
  const balances = generateAccountBalances();
  writeYaml(path.join(OUTPUT_DIR, 'apps/finances/account.balances.yml'), balances);
  console.log('  ✓ apps/finances/account.balances.yml');

  // Transactions
  const transactions = generateTransactionsForRange(startDate, args.days);
  const groupedTransactions = groupTransactionsByMonth(transactions);
  for (const [month, monthData] of Object.entries(groupedTransactions)) {
    const monthDir = path.join(OUTPUT_DIR, 'apps/finances', month);
    ensureDir(monthDir);
    writeYaml(path.join(monthDir, 'transactions.yml'), monthData);
  }
  console.log(`  ✓ ${transactions.entries.length} transactions across ${Object.keys(groupedTransactions).length} months`);

  // ============== Generate calendar data ==============
  console.log('\nGenerating calendar data...');

  // Calendar events
  const calendarEvents = generateCalendarEvents(startDate, args.days + 30); // Include future events
  writeYaml(path.join(OUTPUT_DIR, 'shared/calendar.yml'), calendarEvents);
  console.log(`  ✓ shared/calendar.yml (${calendarEvents.items.length} events)`);

  // Shared events
  const sharedEvents = generateSharedEvents(startDate, args.days);
  writeYaml(path.join(OUTPUT_DIR, 'shared/events.yml'), sharedEvents);
  console.log(`  ✓ shared/events.yml (${sharedEvents.events.length} events)`);

  // ============== Generate nutrition data ==============
  console.log('\nGenerating nutrition data...');

  // Generate nutrition logs
  const nutritionLogs = generateNutritionLogs(startDate, args.days);
  const logCount = Object.keys(nutritionLogs).length;

  // Write user nutrilogs (hot storage)
  for (const user of USERS) {
    const userLogs = generateUserNutrilog(user.id, nutritionLogs);
    if (Object.keys(userLogs).length > 0) {
      writeYaml(path.join(OUTPUT_DIR, 'users', user.id, 'lifelog/nutrition/nutrilog.yml'), userLogs);
    }
  }
  console.log(`  ✓ ${logCount} nutrition log entries`);

  // Generate nutrichart (historical summary)
  const nutrichart = generateNutrichart(nutritionLogs);
  writeYaml(path.join(OUTPUT_DIR, 'history/nutrichart.yml'), nutrichart);
  console.log(`  ✓ history/nutrichart.yml (${nutrichart.entries.length} daily summaries)`);

  // ============== Generate media data ==============
  console.log('\nGenerating media data...');

  // Watchlist
  const watchlist = generateWatchlist();
  writeYaml(path.join(OUTPUT_DIR, 'state/watchlist.yml'), watchlist);
  console.log(`  ✓ state/watchlist.yml (${watchlist.items.length} items)`);

  // Watch history
  const watchHistory = generateWatchHistory(30);
  writeYaml(path.join(OUTPUT_DIR, 'state/watch_history.yml'), watchHistory);
  console.log(`  ✓ state/watch_history.yml (${watchHistory.history.length} entries)`);

  // Media menu
  const mediaMenu = generateMediaMenu();
  writeYaml(path.join(OUTPUT_DIR, 'state/mediamenu.yml'), mediaMenu);
  console.log('  ✓ state/mediamenu.yml');

  // Playlists
  const playlists = generatePlaylists();
  writeYaml(path.join(OUTPUT_DIR, 'state/playlists.yml'), playlists);
  console.log(`  ✓ state/playlists.yml (${playlists.playlists.length} playlists)`);

  // Gratitude entries
  const gratitude = generateGratitudeEntries(args.days);
  writeYaml(path.join(OUTPUT_DIR, 'shared/gratitude/entries.yml'), gratitude);
  console.log(`  ✓ shared/gratitude/entries.yml (${gratitude.entries.length} entries)`);

  // ============== Generate chatbot config ==============
  console.log('\nGenerating app configs...');

  const chatbotsConfig = generateChatbotsConfig();
  writeYaml(path.join(OUTPUT_DIR, 'apps/chatbots.yml'), chatbotsConfig);
  console.log('  ✓ apps/chatbots.yml');

  // ============== Summary ==============
  console.log('\n' + '='.repeat(50));
  console.log('Generation complete!');
  console.log('='.repeat(50));
  console.log(`\nOutput directory: ${OUTPUT_DIR}`);
  console.log(`\nUsers: ${USERS.map(u => u.name).join(', ')}`);
  console.log(`Date range: ${formatDate(startDate)} to ${formatDate(endDate)} (${args.days} days)`);
  console.log(`Seed: ${args.seed} (use --seed=${args.seed} to regenerate identical data)`);

  // List file count
  let fileCount = 0;
  function countFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        countFiles(path.join(dir, item.name));
      } else if (item.name.endsWith('.yml')) {
        fileCount++;
      }
    }
  }
  countFiles(OUTPUT_DIR);
  console.log(`\nTotal YAML files generated: ${fileCount}`);
}

main().catch(err => {
  console.error('Error generating test data:', err);
  process.exit(1);
});
