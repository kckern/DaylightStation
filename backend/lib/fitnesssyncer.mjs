import axios from 'axios';
import qs from 'querystring';
import dotenv from 'dotenv';
import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile } from './io.mjs';

// Configure environment variables
dotenv.config();
const TIMEZONE = 'America/Los_Angeles';

function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}


async function getAccessTokenFromRefreshToken() {
  const { FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET } = process.env;
  const {refresh} = loadFile('auth/fitnesssyncer');
  try {
    const response = await axios.post('https://www.fitnesssyncer.com/api/oauth/access_token',
      qs.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: FITSYNC_CLIENT_ID,
        client_secret: FITSYNC_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, refresh_token } = response.data;
    saveFile('auth/fitnesssyncer', { refresh: refresh_token });
    return {access_token, refresh_token};
  } catch (error) {
    console.error('Failed to get access token from refresh token.');
    throw error;
  }
}

async function loadCredentials() {
  if (process.env.FITSYNC_ACCESS_TOKEN)   return process.env.FITSYNC_ACCESS_TOKEN;
  const { access_token } = await getAccessTokenFromRefreshToken();
  process.env.FITSYNC_ACCESS_TOKEN = access_token;
  
}

async function setSourceId(chatId, sourceKey, store) {
  const userInfo = store[chatId] || {};

  const { items } = await baseAPI('sources');
  const source = items.find((s) => s.providerType === sourceKey);
  if (!source) return null;

  userInfo[sourceKey] = source.id;
  store[chatId] = userInfo;

  return source.id;
}

async function getSourceId(chatId, sourceKey, store) {
  const userInfo = store[chatId] || {};
  if (!userInfo[sourceKey]) {
    return await setSourceId(chatId, sourceKey, store);
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

export async function getActivities(chatId, store) {
  await loadCredentials(chatId, store);
  const garminSourceId = await getSourceId(chatId, 'GarminWellness', store);
  if (!garminSourceId) {
    throw new Error('Failed to determine Garmin source ID.');
  }
  return baseAPI(`sources/${garminSourceId}/items`);
}

export default async function harvestActivities(chatId, store) {
  const data = await getActivities(chatId, store);
  const items = data.items || [];

  const activities = items.map((item) => {
    const { date: timestamp, activity: type, itemId } = item;
    const id = md5(itemId);
    const date = moment(timestamp).tz(TIMEZONE).format('YYYY-MM-DD');

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

  const userInfo = store[chatId] || {};
  const existingActivities = userInfo.activities || [];
  const updatedActivities = [...existingActivities, ...activities];
  userInfo.activities = updatedActivities;
  store[chatId] = userInfo;

  return activities;
}
