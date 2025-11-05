#!/usr/bin/env node

import yaml from 'js-yaml';
import fs from 'fs';
import axios from 'axios';

// Simple axios wrapper
const http = {
  get: async (url) => {
    const response = await axios.get(url);
    return response;
  }
};

// Load config
const configPath = '/Users/kckern/Documents/GitHub/DaylightStation/config.app.yml';
const secretsPath = '/Users/kckern/Documents/GitHub/DaylightStation/config.secrets.yml';
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
const secrets = yaml.load(fs.readFileSync(secretsPath, 'utf8'));
const fullConfig = { ...config, ...secrets };

// Simple Plex class for debugging
class SimplePlex {
  constructor() {
    this.token = fullConfig.PLEX_TOKEN;
    this.baseUrl = fullConfig.plex.port ? `${fullConfig.plex.host}:${fullConfig.plex.port}` : fullConfig.plex.host;
  }
  
  async fetch(paramString) {
    let url = `${this.baseUrl}/${paramString}`;
    if (!/\?/.test(paramString)) url += '?1=1';
    url += `&X-Plex-Token=${this.token}`;
    const response = await axios.get(url);
    return response.data;
  }
  
  async loadMeta(plex, type = '') {
    const response = await this.fetch(`library/metadata/${plex}${type}`);
    return (response?.MediaContainer?.Metadata || []);
  }
}

async function debugPlexSeason() {
  const plex = new SimplePlex();
  
  console.log('\n=== Debug Plex Season Loading ===\n');
  
  // Test show ID 605989 (PE Bowman)
  const showId = '605989';
  const season4Id = '605992';
  console.log(`Loading show: ${showId}`);
  console.log(`Season 4 ID: ${season4Id}`);
  
  // Now let's trace through the actual API logic
  console.log('\n\n=== Simulating API /media/plex/list/605989/playable Logic ===\n');
  
  // Load with playable=true like the API does
  const plexInstance = new SimplePlex();
  const playable = true;
  const shuffle = false;
  
  // Step 1: loadChildrenFromKey
  console.log('Step 1: loadChildrenFromKey(605989, playable=true)');
  const showData = await plexInstance.loadMeta(showId);
  const showType = showData[0].type;
  console.log(`Show type: ${showType}`);
  
  // Step 2: loadListFromKey -> loadListFromShow with playable=true
  console.log('\nStep 2: loadListFromShow(605989, playable=true)');
  console.log('This calls: loadListKeys(605989, "/grandchildren")');
  
  const allEpisodesRaw = await plexInstance.loadMeta(showId, '/grandchildren');
  console.log(`\nRaw API returned ${allEpisodesRaw.length} total episodes`);
  
  // Step 3: loadListKeys processes them
  console.log('\nStep 3: loadListKeys processes metadata');
  const processedList = allEpisodesRaw.map(({ 
    ratingKey,
    parentRatingKey,
    parentTitle,
    title,
    type,
    thumb,
    duration,
    index,
    parentIndex
  })=>{
    return {
      plex: ratingKey,
      title,
      parent: parentRatingKey,
      parentTitle,
      type,
      image: `/plex_proxy${thumb}`,
      duration,
      index,
      parentIndex
    }
  });
  
  console.log(`Processed ${processedList.length} items`);
  
  // Filter to season 4
  const season4ProcessedList = processedList.filter(ep => ep.parent === season4Id);
  console.log(`\nSeason 4 items after processing:`);
  season4ProcessedList.forEach(ep => {
    console.log(`  - ${ep.title} (plex: ${ep.plex}, parent: ${ep.parent})`);
  });
  
  // Step 4: Simulate findUnwatchedItems logic
  console.log('\n\nStep 4: Simulate findUnwatchedItems() logic');
  console.log('Category would be: "plex/fitness"');
  console.log('Loading from: data/history/media_memory/plex/fitness.yaml');
  
  const historyFilePath = '/Users/kckern/Documents/GitHub/DaylightStation/data/history/media_memory/plex/fitness.yaml';
  let fitnessHistory = {};
  
  if (fs.existsSync(historyFilePath)) {
    const content = fs.readFileSync(historyFilePath, 'utf8');
    fitnessHistory = yaml.load(content) || {};
    console.log(`\nLoaded fitness history with ${Object.keys(fitnessHistory).length} entries`);
  } else {
    console.log('\n⚠️ Fitness history file not found!');
  }
  
  // Check Season 4 episodes in history
  const season4Keys = ['605993', '606036', '606037'];
  console.log('\nChecking Season 4 episodes in history:');
  season4Keys.forEach(k => {
    if (fitnessHistory[k]) {
      const percent = fitnessHistory[k].percent || 0;
      const isWatchedValue = percent >= 90;
      console.log(`  ${k}: percent=${percent}%, watched=${isWatchedValue}`);
    } else {
      console.log(`  ${k}: NOT in history (unwatched)`);
    }
  });
  
  // Simulate the filter
  console.log('\nSimulating unwatched filter:');
  const allEpisodeKeys = processedList.map(ep => ep.plex);
  console.log(`Total episodes to filter: ${allEpisodeKeys.length}`);
  
  const unwatchedKeys = allEpisodeKeys.filter(key => {
    const watchedItem = fitnessHistory[key];
    if (!watchedItem) return true; // Not in history = unwatched
    const percent = watchedItem.percent || 0;
    return percent < 90; // Less than 90% = not watched
  });
  
  console.log(`Unwatched episodes: ${unwatchedKeys.length}`);
  
  const unwatchedSeason4 = season4Keys.filter(k => unwatchedKeys.includes(k));
  console.log(`\nUnwatched Season 4 episodes: ${unwatchedSeason4.length}`);
  unwatchedSeason4.forEach(k => {
    const ep = processedList.find(e => e.plex === k);
    console.log(`  - ${ep?.title} (${k})`);
  });
  
  console.log('\n=== Debug Complete ===\n');
}

debugPlexSeason().catch(console.error);
