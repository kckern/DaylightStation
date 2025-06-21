import axios from 'axios';
import qs from 'querystring';
import dotenv from 'dotenv';
import { loadFile, saveFile } from './io.mjs';
import moment from 'moment-timezone';
import crypto from 'crypto';

// Configure environment variables
dotenv.config();
const TIMEZONE = 'America/Los_Angeles';

// ────────────────────────────────────────────────────────────────────────────────
// Helpers for storing/retrieving data in fitnessActivities
// ────────────────────────────────────────────────────────────────────────────────
function loadStore() {
  return loadFile('fitnessActivities') || {};
}

function saveStore(store) {
  saveFile('fitnessActivities', store);
}

function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────────────
// Token and source management (private)
// ────────────────────────────────────────────────────────────────────────────────

async function getTokensFromCode(code) {
  // If no code is provided, log link and exit for dev convenience
  const { FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET } = process.env;
  const redirectUri = 'https://personal.fitnesssyncer.com/';
  const link = `https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=${redirectUri}&state=InformationForYourService`;

  if (!code) {
    console.log(`No code provided. Please visit: ${link}`);
    process.exit(1);
  }

  try {
    const response = await axios.post('https://api.fitnesssyncer.com/api/oauth/access_token',
      qs.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: FITSYNC_CLIENT_ID,
        client_secret: FITSYNC_CLIENT_SECRET,
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data;
  } catch (error) {
    console.error(`Failed to retrieve tokens. Try this link: ${link}`);
    throw error;
  }
}

async function getAccessTokenFromRefreshToken(refreshToken) {
  const { FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET } = process.env;
  try {
    const response = await axios.post('https://www.fitnesssyncer.com/api/oauth/access_token',
      qs.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: FITSYNC_CLIENT_ID,
        client_secret: FITSYNC_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to get access token from refresh token.');
    throw error;
  }
}

async function loadCredentials(chatId) {
  // Check if current environment has a valid token
  if (process.env.FITSYNC_ACCESS_TOKEN) {
    // Already loaded into environment, skip
    return;
  }

  // Otherwise, load from store
  const store = loadStore();
  const userInfo = store[chatId] || {};
  const { FITSYNC_REFRESH_TOKEN } = userInfo;

  if (!FITSYNC_REFRESH_TOKEN) {
    console.log(`No refresh token found for chatId ${chatId}. Please authorize: 
https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${process.env.FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=https://personal.fitnesssyncer.com/&state=InformationForYourService`);
    throw new Error('Missing refresh token - cannot continue.');
  }

  // Refresh tokens
  const { access_token, refresh_token } = await getAccessTokenFromRefreshToken(FITSYNC_REFRESH_TOKEN);

  // Set environment for immediate usage
  process.env.FITSYNC_ACCESS_TOKEN = access_token;
  process.env.FITSYNC_REFRESH_TOKEN = refresh_token;

  // Save updated tokens back to store
  userInfo.FITSYNC_ACCESS_TOKEN = access_token;
  userInfo.FITSYNC_REFRESH_TOKEN = refresh_token;
  store[chatId] = userInfo;
  saveStore(store);
}

async function setSourceId(chatId, sourceKey) {
  const store = loadStore();
  const userInfo = store[chatId] || {};

  const { items } = await baseAPI('sources');
  const source = items.find((s) => s.providerType === sourceKey);
  if (!source) return null;

  userInfo[sourceKey] = source.id;
  store[chatId] = userInfo;
  saveStore(store);

  return source.id;
}

async function getSourceId(chatId, sourceKey) {
  const store = loadStore();
  const userInfo = store[chatId] || {};
  if (!userInfo[sourceKey]) {
    return await setSourceId(chatId, sourceKey);
  }
  return userInfo[sourceKey];
}

// ────────────────────────────────────────────────────────────────────────────────
// Base API for making GET requests to FitnessSyncer (private)
// ────────────────────────────────────────────────────────────────────────────────
async function baseAPI(endpoint) {
  const baseUrl = 'https://api.fitnesssyncer.com/api/providers';
  const { FITSYNC_ACCESS_TOKEN } = process.env;

  if (!FITSYNC_ACCESS_TOKEN) {
    throw new Error('No access token available. Make sure loadCredentials() is called first.');
  }

  try {
    const url = `${baseUrl}/${endpoint}`;
    const headers = { Authorization: `Bearer ${FITSYNC_ACCESS_TOKEN}` };

    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    console.error(`Error fetching data from endpoint "${endpoint}":`, error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Publicly Exposed Functions
// ────────────────────────────────────────────────────────────────────────────────

/**
 * getActivities
 *  - Ensures valid credentials
 *  - Retrieves GarminWellness activities from FitnessSyncer
 *  - Returns the raw data
 */
export async function getActivities(chatId) {
  await loadCredentials(chatId);
  const garminSourceId = await getSourceId(chatId, 'GarminWellness');
  if (!garminSourceId) {
    throw new Error('Failed to determine Garmin source ID.');
  }
  return baseAPI(`sources/${garminSourceId}/items`);
}

/**
 * harvestActivities
 *  - Fetches Garmin activities using getActivities()
 *  - Processes/cleans data
 *  - Stores them in "fitnessActivities" file
 *  - Returns the processed array
 */
export async function harvestActivities(chatId) {
  const data = await getActivities(chatId);
  const items = data.items || [];

  // Transform each item
  const activities = items.map((item) => {
    const { date: timestamp, activity: type, itemId } = item;
    const id = md5(itemId);
    const date = moment(timestamp).tz(TIMEZONE).format('YYYY-MM-DD');

    // Remove gps info
    const safeItem = { ...item };
    delete safeItem.gps;

    return {
      chatId,
      src: 'garmin',
      id,
      date,
      type,
      data: safeItem,
    };
  });

  // Load existing activities from the file
  const store = loadStore();
  const userInfo = store[chatId] || {};

  // Combine with existing if needed:
  // Example: we can store an array of activity objects under `userInfo.activities`
  const existingActivities = userInfo.activities || [];

  // For simplicity, just append new ones (you could deduplicate if needed)
  const updatedActivities = [...existingActivities, ...activities];
  userInfo.activities = updatedActivities;
  store[chatId] = userInfo;
  saveStore(store);

  return activities;
}