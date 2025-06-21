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


export const getSourceId = async (sourceKey) => {
 const { items } = await baseAPI('sources');
 const source = items.find(source => source.providerType === sourceKey);
 if (!source) return false;
 return source.id;
};



// ────────────────────────────────────────────────────────────────────────────────
// Base API for making GET requests to FitnessSyncer (private)
// ────────────────────────────────────────────────────────────────────────────────
async function baseAPI(endpoint) {
  const baseUrl = 'https://api.fitnesssyncer.com/api/providers';
  await loadCredentials();
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


export const getActivities = async () => {
    await getAccessToken();
    const garminSourceId = await getSourceId('GarminWellness');
    if (!garminSourceId) throw new Error('Failed to get garmin source id');

    const activities = [];
    let offset = 0;
    const limit = 100; // Adjust limit as needed
    const oneYearAgo = moment().subtract(1, 'year').startOf('day');

    while (true) {
        const response = await baseAPI(`sources/${garminSourceId}/items?offset=${offset}&limit=${limit}`);
        const items = response.items || [];
        if (items.length === 0) break;

        const filteredItems = items.filter(item => moment(item.date).isAfter(oneYearAgo));
        activities.push(...filteredItems);

        if (filteredItems.length < items.length) break; // Stop if items are outside the 1-year range
        offset += limit;
    }

    return { items: activities };
};

const harvestActivities = async () => {
  try {
    const activitiesData = await getActivities();
    const activities = activitiesData.items.map(item => {
      delete item.gps;
      const src = "garmin";
      const { date: timestamp, activity: type, itemId } = item;
      const id = md5(itemId);
      const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
      const saveMe = { src, id, date, type, data: item };
      return saveMe;
    });

    const harvestedDates = activities.map(activity => activity.date);
    const onFile = loadFile('lifelog/fitness') || {};
    const onFilesDates = Object.keys(onFile || {});
    const uniqueDates = [...new Set([...harvestedDates, ...onFilesDates])].sort((b, a) => new Date(a) - new Date(b))
      .filter(date => moment(date, 'YYYY-MM-DD', true).isValid() && moment(date, 'YYYY-MM-DD').isBefore(moment().add(1, 'year')));

    const saveMe = uniqueDates.reduce((acc, date) => {
      acc[date] = activities
        .filter(activity => activity.date === date)
        .reduce((dateAcc, activity) => {
          const keys = Object.keys(activity.data || {});
          keys.forEach(key => {
            if (!activity.data[key]) delete activity.data[key];
          });
          dateAcc[activity.id] = activity;
          return dateAcc;
        }, {});
      return acc;
    }, {});

    saveFile('lifelog/fitness_long', saveMe);
    //reduce
    const reducedSaveMe = Object.keys(saveMe).reduce((acc, date) => {
      acc[date] = {
        steps: {
          steps_count: Object.values(saveMe[date])
            .filter(activity => activity.type === 'Steps')
            .reduce((sum, activity) => sum + (activity.data.steps || 0), 0),
          bmr: Object.values(saveMe[date])
            .filter(activity => activity.type === 'Steps')
            .reduce((sum, activity) => sum + (activity.data.bmr || 0), 0),
          duration: parseFloat(Object.values(saveMe[date])
            .filter(activity => activity.type === 'Steps')
            .reduce((sum, activity) => sum + (activity.data.duration / 60 || 0), 0)
            .toFixed(2)),
          calories: parseFloat(Object.values(saveMe[date])
            .filter(activity => activity.type === 'Steps')
            .reduce((sum, activity) => sum + (activity.data.calories || 0), 0)
            .toFixed(2)),
          maxHeartRate: Math.max(
            ...Object.values(saveMe[date])
              .filter(activity => activity.type === 'Steps')
              .map(activity => activity.data.maxHeartrate || 0)
          ),
          avgHeartRate: parseFloat(Math.round(
            Object.values(saveMe[date])
              .filter(activity => activity.type === 'Steps')
              .reduce((sum, activity) => sum + (activity.data.avgHeartrate || 0), 0) /
            Object.values(saveMe[date])
              .filter(activity => activity.type === 'Steps').length || 1
          ).toFixed(2)),
        },
        activities: Object.values(saveMe[date])
          .filter(activity => activity.type !== 'Steps')
          .map(activity => ({
            title: activity.data.title || '',
            calories: parseFloat((activity.data.calories || 0).toFixed(2)),
            distance: parseFloat((activity.data.distance || 0).toFixed(2)),
            minutes: parseFloat((activity.data.duration / 60 || 0).toFixed(2)),
            startTime: activity.data.date ? moment(activity.data.date).tz(timezone).format('hh:mm a') : '',
            endTime: activity.data.endDate ? moment(activity.data.endDate).tz(timezone).format('hh:mm a') : '',
            avgHeartrate: parseFloat((activity.data.avgHeartrate || 0).toFixed(2)),
          })),
      };
      if (acc[date].activities.length === 0) delete acc[date].activities;
      return acc;
    }, {});
    saveFile('lifelog/fitness', reducedSaveMe);

    return reducedSaveMe;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default harvestActivities;