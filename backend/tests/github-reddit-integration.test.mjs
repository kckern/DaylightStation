#!/usr/bin/env node
/**
 * GitHub and Reddit Harvesters Integration Test
 * 
 * Tests that the harvesters can successfully fetch data with real credentials
 * Run: node backend/tests/github-reddit-integration.test.mjs
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Set up environment properly using config loader (same as server)
process.chdir(projectRoot);

import { resolveConfigPaths } from '../lib/config/pathResolver.mjs';
import { loadAllConfig } from '../lib/config/loader.mjs';
import { hydrateProcessEnvFromConfigs } from '../lib/logging/config.js';
import { configService } from '../lib/config/ConfigService.mjs';

// Initialize config the same way the server does
const isDocker = fs.existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: projectRoot });

// Hydrate process.env from config files (this sets process.env.path)
hydrateProcessEnvFromConfigs(configPaths.configDir);

// Initialize ConfigService
configService.init(projectRoot);

console.log('🧪 Testing GitHub and Reddit Harvesters\n');
console.log('Data path:', process.env.path?.data);
console.log('Head of household:', configService.getHeadOfHousehold());
console.log('');

// Test GitHub Harvester
console.log('📦 Testing GitHub Harvester...');
try {
    const github = await import('../lib/github.mjs');
    const result = await github.default('test-integration');
    
    console.log(`✅ GitHub: Successfully fetched ${result.length} activities`);
    
    if (result.length > 0) {
        const sample = result[0];
        console.log(`   Latest activity: ${sample.type} on ${sample.repo} (${sample.date})`);
        
        const types = [...new Set(result.map(a => a.type))];
        console.log(`   Activity types: ${types.join(', ')}`);
    }
    console.log('');
} catch (error) {
    console.error('❌ GitHub harvester failed:', error.message);
    console.error('   Stack:', error.stack?.split('\n')[1]?.trim());
    console.log('');
}

// Test Reddit Harvester
console.log('📱 Testing Reddit Harvester...');
try {
    const reddit = await import('../lib/reddit.mjs');
    const result = await reddit.default('test-integration');
    
    console.log(`✅ Reddit: Successfully fetched ${result.length} activities`);
    
    if (result.length > 0) {
        const sample = result[0];
        const stats = {
            posts: result.filter(a => a.type === 'post').length,
            comments: result.filter(a => a.type === 'comment').length,
            subreddits: [...new Set(result.map(a => a.subreddit))].length
        };
        
        console.log(`   Latest: ${sample.type} in r/${sample.subreddit} (${sample.date})`);
        console.log(`   Stats: ${stats.posts} posts, ${stats.comments} comments across ${stats.subreddits} subreddits`);
    }
    console.log('');
} catch (error) {
    console.error('❌ Reddit harvester failed:', error.message);
    console.error('   Stack:', error.stack?.split('\n')[1]?.trim());
    console.log('');
}

// Check saved files
console.log('📁 Checking saved data files...');
const username = configService.getHeadOfHousehold();
const dataPath = configService.getDataDir();

// userSaveFile saves to lifelog/{service}.yml
const githubFile = path.join(dataPath, 'users', username, 'lifelog', 'github.yml');
const redditFile = path.join(dataPath, 'users', username, 'lifelog', 'reddit.yml');

console.log(`   GitHub data: ${fs.existsSync(githubFile) ? '✅ Exists' : '❌ Not found'}`);
console.log(`   Reddit data: ${fs.existsSync(redditFile) ? '✅ Exists' : '❌ Not found'}`);

console.log('\n✨ Integration test complete!');
