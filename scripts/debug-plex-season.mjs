#!/usr/bin/env node

import yaml from 'js-yaml';
import fs from 'fs';
import axios from 'axios';

const formatArg = (arg) => {
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg, null, 2); }
  catch (_) { return String(arg); }
};

const write = (stream, ...args) => {
  stream.write(args.map(formatArg).join(' ') + '\n');
};

const logInfo = (...args) => write(process.stdout, ...args);
const logError = (...args) => write(process.stderr, ...args);

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
  
  logInfo('\n=== Debug Plex Season Loading ===\n');
  
  // Test show ID 605989 (PE Bowman)
  const showId = '605989';
  const season4Id = '605992';
  logInfo(`Loading show: ${showId}`);
  logInfo(`Season 4 ID: ${season4Id}`);
  
  // Now let's trace through the actual API logic
  logInfo('\n\n=== Simulating API /media/plex/list/605989/playable Logic ===\n');
  
  // Load with playable=true like the API does
  const plexInstance = new SimplePlex();
  const playable = true;
  const shuffle = false;
  
  // Step 1: loadChildrenFromKey
  logInfo('Step 1: loadChildrenFromKey(605989, playable=true)');
  const showData = await plexInstance.loadMeta(showId);
  const showType = showData[0].type;
  logInfo(`Show type: ${showType}`);
  
  // Step 2: loadListFromKey -> loadListFromShow with playable=true
  logInfo('\nStep 2: loadListFromShow(605989, playable=true)');
  logInfo('This calls: loadListKeys(605989, "/grandchildren")');
  
  const allEpisodesRaw = await plexInstance.loadMeta(showId, '/grandchildren');
  logInfo(`\nRaw API returned ${allEpisodesRaw.length} total episodes`);
  
  // Step 3: loadListKeys processes them
  logInfo('\nStep 3: loadListKeys processes metadata');
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
  
  logInfo(`Processed ${processedList.length} items`);
  
  // Filter to season 4
  const season4ProcessedList = processedList.filter(ep => ep.parent === season4Id);
  logInfo(`\nSeason 4 items after processing:`);
  season4ProcessedList.forEach(ep => {
    logInfo(`  - ${ep.title} (plex: ${ep.plex}, parent: ${ep.parent})`);
  });
  
  // Step 4: Simulate findUnwatchedItems logic
  logInfo('\n\nStep 4: Simulate findUnwatchedItems() logic');
  logInfo('Category would be: "plex/fitness"');
  logInfo('Loading from: data/history/media_memory/plex/fitness.yaml');
  
  const historyFilePath = '/Users/kckern/Documents/GitHub/DaylightStation/data/history/media_memory/plex/fitness.yaml';
  let fitnessHistory = {};
  
  if (fs.existsSync(historyFilePath)) {
    const content = fs.readFileSync(historyFilePath, 'utf8');
    fitnessHistory = yaml.load(content) || {};
    logInfo(`\nLoaded fitness history with ${Object.keys(fitnessHistory).length} entries`);
  } else {
    logInfo('\n⚠️ Fitness history file not found!');
  }
  
  // Check Season 4 episodes in history
  const season4Keys = ['605993', '606036', '606037'];
  logInfo('\nChecking Season 4 episodes in history:');
  season4Keys.forEach(k => {
    if (fitnessHistory[k]) {
      const percent = fitnessHistory[k].percent || 0;
      const isWatchedValue = percent >= 90;
      logInfo(`  ${k}: percent=${percent}%, watched=${isWatchedValue}`);
    } else {
      logInfo(`  ${k}: NOT in history (unwatched)`);
    }
  });
  
  // Simulate the filter
  logInfo('\nSimulating unwatched filter:');
  const allEpisodeKeys = processedList.map(ep => ep.plex);
  logInfo(`Total episodes to filter: ${allEpisodeKeys.length}`);
  
  const unwatchedKeys = allEpisodeKeys.filter(key => {
    const watchedItem = fitnessHistory[key];
    if (!watchedItem) return true; // Not in history = unwatched
    const percent = watchedItem.percent || 0;
    return percent < 90; // Less than 90% = not watched
  });
  
  logInfo(`Unwatched episodes: ${unwatchedKeys.length}`);
  
  const unwatchedSeason4 = season4Keys.filter(k => unwatchedKeys.includes(k));
  logInfo(`\nUnwatched Season 4 episodes: ${unwatchedSeason4.length}`);
  unwatchedSeason4.forEach(k => {
    const ep = processedList.find(e => e.plex === k);
    logInfo(`  - ${ep?.title} (${k})`);
  });
  
  logInfo('\n=== Debug Complete ===\n');
}

debugPlexSeason().catch((err) => logError('Unhandled error in debugPlexSeason', err?.stack || err));
