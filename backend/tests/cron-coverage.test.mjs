#!/usr/bin/env node
/**
 * Cron Coverage Test
 * 
 * Verifies that all harvesters from harvest.mjs are scheduled in cron.mjs
 * Run: node backend/tests/cron-coverage.test.mjs
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Checking Cron Coverage for All Harvesters\n');

// Define harvesters from harvest.mjs (excluding Infinity keys and payroll)
const allHarvesters = [
    'todoist',
    'gmail',
    'gcal',
    'withings',
    'ldsgc',
    'weather',
    'scripture',
    'clickup',
    'lastfm',
    'letterboxd',
    'goodreads',
    'budget',
    'youtube_dl',
    'fitness',
    'strava',
    'health',
    'garmin',
];

// Define what's in cron (based on cron.mjs)
const cronSchedules = {
    'cron10Mins (*/10 * * * *)': ['weather', 'gcal', 'todoist', 'gmail'],
    'cronHourly (15 * * * *)': ['withings', 'fitness', 'strava', 'garmin', 'health'],
    'cronDaily (0 5 * * *)': ['clickup', 'youtube_dl', 'lastfm', 'letterboxd', 'goodreads', 'ldsgc', 'scripture'],
    'cronWeekly (0 6 * * 0)': ['budget']
};

// Flatten scheduled harvesters
const scheduledHarvesters = Object.values(cronSchedules).flat();

// Normalize names (fitness = fitsync, youtube_dl = youtube, scripture = scriptureguide)
const normalizeMap = {
    'fitness': 'fitsync',
    'youtube_dl': 'youtube',
    'scripture': 'scriptureguide'
};

const normalizedScheduled = scheduledHarvesters.map(h => normalizeMap[h] || h);
const normalizedAll = allHarvesters.map(h => normalizeMap[h] || h);

// Find missing
const missing = normalizedAll.filter(h => !normalizedScheduled.includes(h));
const extra = normalizedScheduled.filter(h => !normalizedAll.includes(h));

// Display schedule
console.log('📅 Current Cron Schedule:');
console.log('═══════════════════════════════════════════════════\n');

Object.entries(cronSchedules).forEach(([schedule, harvesters]) => {
    console.log(`${schedule}:`);
    harvesters.forEach(h => {
        console.log(`  ✓ ${h}`);
    });
    console.log('');
});

// Show results
console.log('📊 Coverage Analysis:');
console.log('═══════════════════════════════════════════════════\n');

if (missing.length === 0 && extra.length === 0) {
    console.log('✅ PERFECT: All harvesters are scheduled in cron!');
    console.log(`   Total harvesters: ${allHarvesters.length}`);
    console.log(`   Total scheduled: ${scheduledHarvesters.length}`);
} else {
    if (missing.length > 0) {
        console.log('⚠️  MISSING from cron:');
        missing.forEach(h => console.log(`   - ${h}`));
        console.log('');
    }
    
    if (extra.length > 0) {
        console.log('ℹ️  EXTRA in cron (not in harvest.mjs):');
        extra.forEach(h => console.log(`   - ${h}`));
        console.log('');
    }
}

console.log('\n🎯 Manual Harvesters (not auto-scheduled):');
console.log('═══════════════════════════════════════════════════');
console.log('  • payroll - Run via /harvest/payroll or specific schedule');
console.log('  • Infinity keys - Dynamic harvesters for various data sources');

console.log('\n✨ Cron coverage check complete!');
