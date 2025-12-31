#!/usr/bin/env node
/**
 * Test Morning Debrief Locally (Dry Run)
 * 
 * Generates the debrief and displays it without sending to Telegram
 * 
 * Usage:
 *   node test-debrief-local.mjs [username] [date]
 */

// Load config first (required for io.mjs)
import { loadAllConfig } from '../../../lib/config/loader.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../');

// Determine if running in docker or dev
const isDocker = process.env.DOCKER === 'true';
// In dev, config files are in mounted volume, not repo
const configDir = isDocker 
  ? '/usr/src/app' 
  : '/Volumes/mounts/DockerDrive/Docker/DaylightStation/config';
const dataDir = isDocker 
  ? '/usr/src/app/data' 
  : '/Volumes/mounts/DockerDrive/Docker/DaylightStation/data';

// Load and populate process.env with config
const configResult = loadAllConfig({
  configDir,
  dataDir,
  isDocker,
  isDev: !isDocker
});

process.env = { ...process.env, isDocker, ...configResult.config };

// Now import modules that depend on process.env.path
import { LifelogAggregator } from './adapters/LifelogAggregator.mjs';
import { GenerateMorningDebrief } from './application/usecases/GenerateMorningDebrief.mjs';
import { DebriefRepository } from './infrastructure/DebriefRepository.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { configService } from '../../../lib/config/ConfigService.mjs';
import { OpenAIGateway } from '../../infrastructure/ai/OpenAIGateway.mjs';

const args = process.argv.slice(2);
const username = args[0] || configService.getHeadOfHousehold();
const date = args[1] || null;
const skipAI = args.includes('--no-ai') || args.includes('--aggregation-only');

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║     Morning Debrief Test ${skipAI ? '(Aggregation Only)' : '(REAL AI)'}${''.padEnd(skipAI ? 12 : 18)}║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');
console.log(`👤 User:     ${username}`);
console.log(`📅 Date:     ${date || 'yesterday (auto)'}`);
console.log(`⏱️  Starting: ${new Date().toLocaleString()}\n`);

async function test() {
  const logger = createLogger({ source: 'test', app: 'journalist' });
  
  try {
    console.log('📦 Step 1: Aggregating lifelog data...');
    const aggregator = new LifelogAggregator({ logger });
    const lifelog = await aggregator.aggregate(username, date);
    
    console.log(`   ✓ Found ${lifelog._meta.availableSourceCount} data sources`);
    console.log(`   ✓ Date: ${lifelog._meta.date}`);
    console.log(`   ✓ Sources: ${lifelog._meta.sources.join(', ') || 'none'}`);
    console.log(`   ✓ Categories: ${lifelog._meta.categories.join(', ') || 'none'}`);
    console.log(`   ✓ Has enough data: ${lifelog._meta.hasEnoughData ? 'Yes' : 'No'}\n`);
    
    // Show the actual extracted summaries
    if (lifelog.summaryText) {
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║          📊 EXTRACTED DATA (AI PROMPT INPUT)             ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
      console.log(lifelog.summaryText);
      console.log('\n');
    } else {
      console.log('⚠️  No data extracted for this date.\n');
    }

    // Skip AI if requested
    if (skipAI) {
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║               📊 RAW EXTRACTED SOURCES                   ║');
      console.log('╚══════════════════════════════════════════════════════════╝\n');
      
      if (Object.keys(lifelog.sources).length > 0) {
        for (const [source, data] of Object.entries(lifelog.sources)) {
          const count = Array.isArray(data) ? data.length : 
                        typeof data === 'object' ? Object.keys(data).length : 1;
          console.log(`✓ ${source}: ${count} ${Array.isArray(data) ? 'items' : 'data points'}`);
        }
      } else {
        console.log('(No data extracted for this date)');
      }
      console.log('');
      console.log('✅ Aggregation test complete!\n');
      console.log('To run with AI generation, remove --no-ai flag');
      return;
    }
    
    console.log('🤖 Step 2: Generating debrief with REAL AI (OpenAI)...');
    console.log('   ⚠️  This will use OpenAI API tokens!\n');
    
    // Get OpenAI key from environment or config
    const openAIKey = process.env.OPENAI_API_KEY || process.env.OPENAI_PK;
    if (!openAIKey) {
      console.log('⚠️  OPENAI_API_KEY not found - skipping AI generation');
      console.log('   Run with --no-ai to skip AI and just test aggregation\n');
      console.log('✅ Aggregation test complete!\n');
      return;
    }
    
    const aiGateway = new OpenAIGateway(
      { apiKey: openAIKey },
      { logger }
    );
    
    const generator = new GenerateMorningDebrief({
      lifelogAggregator: aggregator,
      aiGateway,
      logger
    });
    
    const debrief = await generator.execute({ username, date });
    
    console.log(`   ✓ Success: ${debrief.success}`);
    if (!debrief.success) {
      console.log(`   ✗ Reason: ${debrief.reason}\n`);
      console.log('📱 Fallback Message:');
      console.log('─────────────────────────────────────────────────────');
      console.log(debrief.fallbackPrompt);
      console.log('─────────────────────────────────────────────────────\n');
      return;
    }
    
    console.log(`   ✓ Categories: ${debrief.categories.length} available\n`);
    
    // Display the Telegram message
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║             📱 TELEGRAM MESSAGE PREVIEW                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    console.log(`📅 *Yesterday* (${debrief.date})`);
    console.log('');
    console.log(debrief.summary);
    console.log('');
    
    // Display main keyboard
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│                    REPLY KEYBOARD                        │');
    console.log('├─────────────────────────────────────────────────────────┤');
    console.log('│  [📊 Show Details]   [💬 Ask Me]   [✅ Accept]           │');
    console.log('└─────────────────────────────────────────────────────────┘\n');
    
    // Show source picker (2nd level keyboard preview)
    const sourceIcons = {
      garmin: '⌚', strava: '🏋️', fitness: '🏃', weight: '⚖️',
      events: '📆', github: '💻', checkins: '📍', reddit: '💬'
    };
    const sources = debrief.lifelog?._meta?.sources || [];
    if (sources.length > 0) {
      console.log('┌─────────────────────────────────────────────────────────┐');
      console.log('│           📊 SHOW DETAILS (2nd Level Keyboard)          │');
      console.log('├─────────────────────────────────────────────────────────┤');
      const sourceButtons = sources.map(s => `[${sourceIcons[s] || '📄'} ${s}]`);
      // Display in rows of 3
      for (let i = 0; i < sourceButtons.length; i += 3) {
        const row = sourceButtons.slice(i, i + 3).join('  ');
        console.log(`│  ${row}`.padEnd(59) + '│');
      }
      console.log('│  [← Back]                                               │');
      console.log('└─────────────────────────────────────────────────────────┘\n');
    }
    
    // Show questions for "Ask Me" flow
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          📝 GENERATED QUESTIONS (Ask Me Flow)            ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    for (const category of debrief.categories) {
      const questions = debrief.questions[category.key];
      if (questions && questions.length > 0) {
        console.log(`${category.icon} ${category.label}:`);
        questions.forEach((q, idx) => {
          console.log(`   ${idx + 1}. ${q}`);
        });
        console.log('');
      }
    }
    
    // Show raw data summary
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║               📊 RAW EXTRACTED SOURCES                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    // List all sources that had data
    if (Object.keys(lifelog.sources).length > 0) {
      for (const [source, data] of Object.entries(lifelog.sources)) {
        const count = Array.isArray(data) ? data.length : 
                      typeof data === 'object' ? Object.keys(data).length : 1;
        console.log(`✓ ${source}: ${count} ${Array.isArray(data) ? 'items' : 'data points'}`);
      }
    } else {
      console.log('(No data extracted for this date)');
    }
    console.log('');
    
    // Test persisting to debriefs.yml
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║           💾 TESTING DEBRIEF PERSISTENCE                ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    const debriefRepo = new DebriefRepository({
      logger,
      dataPath: `${dataDir}/users/${username}/lifelog/journalist`
    });
    
    await debriefRepo.appendDebrief({
      date: debrief.date,
      timestamp: new Date().toISOString(),
      summary: debrief.summary,
      questions: debrief.questions,
      categories: debrief.categories,
      sources: lifelog._meta?.sources || []
    });
    
    console.log(`✓ Debrief appended to debriefs.yml`);
    console.log(`  Path: ${dataDir}/users/${username}/lifelog/journalist/debriefs.yml\n`);
    
    console.log('✅ Test complete!\n');
    console.log('To send this to Telegram for real, use:');
    console.log(`   curl "http://localhost:3112/journalist/morning?user=${username}"\n`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
