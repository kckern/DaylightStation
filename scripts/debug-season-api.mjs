#!/usr/bin/env node

import axios from 'axios';

const log = (...args) => process.stdout.write(`${args.join(' ')}\n`);
const logError = (...args) => process.stderr.write(`${args.join(' ')}\n`);

async function debugSeasonAPI() {
  log('\n=== Testing Season 4 API Endpoint ===\n');
  
  // Test 1: Query the show with playable
  log('Test 1: Querying show 605989 with /playable');
  const showResponse = await axios.get('http://localhost:3112/media/plex/list/605989/playable');
  const showData = showResponse.data;
  
  const season4Items = showData.items.filter(item => item.seasonId === '605992');
  log(`Found ${season4Items.length} Season 4 items from show query:`);
  season4Items.forEach(item => {
    log(`  - Episode ${item.episodeNumber}: ${item.label} (${item.plex})`);
  });
  
  // Test 2: Query the season directly with playable
  log('\n\nTest 2: Querying season 605992 directly with /playable');
  const seasonResponse = await axios.get('http://localhost:3112/media/plex/list/605992/playable');
  const seasonData = seasonResponse.data;
  
  log(`Found ${seasonData.items.length} items from season query:`);
  seasonData.items.forEach(item => {
    log(`  - Episode ${item.episodeNumber}: ${item.label} (${item.plex})`);
  });
  
  // Test 3: Query the season without playable
  log('\n\nTest 3: Querying season 605992 WITHOUT /playable');
  const seasonNoPlayableResponse = await axios.get('http://localhost:3112/media/plex/list/605992');
  const seasonNoPlayableData = seasonNoPlayableResponse.data;
  
  log(`Found ${seasonNoPlayableData.items.length} items from season query (no playable):`);
  seasonNoPlayableData.items.forEach(item => {
    log(`  - Episode ${item.episodeNumber}: ${item.label} (${item.plex})`);
  });
  
  log('\n=== Analysis ===\n');
  log(`Season 4 has 3 episodes in Plex: 605993, 606036, 606037`);
  log(`Expected: All 3 episodes should appear`);
  log(`Actual from show query: ${season4Items.length} episodes`);
  log(`Actual from season query: ${seasonData.items.length} episodes`);
  log(`Actual from season (no playable): ${seasonNoPlayableData.items.length} episodes`);
}

debugSeasonAPI().catch((err) => {
  logError('debugSeasonAPI failed:', err?.message || err);
});
