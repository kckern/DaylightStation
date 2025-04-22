import fetch from 'node-fetch';
import qs from 'querystring';
import dotenv from 'dotenv';
import {getNutriCursor, loadWeight, saveActivities, saveWeight, setNutriCursor} from './db.mjs';
import moment from 'moment-timezone';
import crypto from 'crypto';
import fs from 'fs';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

const timezone = 'America/Los_Angeles';
dotenv.config();


export const getTokensFromCode = async (code) => {
    const {FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET} = process.env;
    const redirect_uri = 'https://personal.fitnesssyncer.com/';
    const link = `https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=${redirect_uri}&state=InformationForYourService`;
    if(!code) process.exit(console.log(link));

    try{
        const tokenResponse = await fetch('https://api.fitnesssyncer.com/api/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: qs.stringify({
                grant_type: 'authorization_code',
                code: code,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET,
                redirect_uri: redirect_uri
            })
        });
        if (!tokenResponse.ok) return console.error({error: 'Failed to get tokens from code.', tokenResponse});
        const tokenData = await tokenResponse.json();
        return tokenData;
    }
    catch (error) {
        console.error(`Try this link: ${link}`);
        throw error;
    }
};

export const getAccessTokenFromRefreshToken = async (refresh_token) => {
    const {FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET} = process.env;
    try {
        const tokenResponse = await fetch('https://www.fitnesssyncer.com/api/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: qs.stringify({
                grant_type: 'refresh_token',
                refresh_token: refresh_token,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET
            })
        });
        if (!tokenResponse.ok) throw new Error('Failed to get access token from refresh token.');
        const tokenData = await tokenResponse.json();
        console.log({tokenData});
        return tokenData;
    } catch (error) {
        console.error('Failed to get access token from refresh token.');
        throw error;
    }
}

const baseAPI = async (endpoint) => {
    //https://api.fitnesssyncer.com/api/providers/sources/id/items/
    const base_url = `https://api.fitnesssyncer.com/api/providers`;
    const {FITSYNC_ACCESS_TOKEN} = process.env;
    try{
        // Step 2: Use the access token to get data from the specified endpoint
        const url = `${base_url}/${endpoint}`;
        const headers =  { 'Authorization': `Bearer ${FITSYNC_ACCESS_TOKEN}` };
        const dataResponse = await fetch(`${url}`, {
            method: 'GET',
            headers
        });
        //console.log({url, headers, curl: `curl ${url} -H "Authorization: Bearer ${FITSYNC_ACCESS_TOKEN}"`});
        if (!dataResponse.ok) throw new Error('Failed to fetch data from endpoint.');
        const data = await dataResponse.json();
        return data;
    } catch (error) {
        console.error(`Error fetching data from ${endpoint}:`, error);
        throw error;
    }
};


export const loadCredentials = async (chat_id) => {
    const {FITSYNC_ACCESS_TOKEN} = process.env;
    if(FITSYNC_ACCESS_TOKEN) return true;
    const cursor = await getNutriCursor(chat_id);
    const {FITSYNC_REFRESH_TOKEN} = cursor;
    if(!FITSYNC_REFRESH_TOKEN) return console.log(`https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${process.env.FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=https://personal.fitnesssyncer.com/&state=InformationForYourService`);
    const {access_token, refresh_token} = await getAccessTokenFromRefreshToken(FITSYNC_REFRESH_TOKEN);
    cursor['FITSYNC_ACCESS_TOKEN'] = access_token;
    cursor['FITSYNC_REFRESH_TOKEN'] = refresh_token;
    process.env.FITSYNC_ACCESS_TOKEN = access_token;
    process.env.FITSYNC_REFRESH_TOKEN = refresh_token;
    await setNutriCursor(chat_id, cursor);
    return true;
}

export const setSourceId = async (chat_id, sourceKey) => {
    const cursor = await getNutriCursor(chat_id);
    const {items} = await baseAPI('sources');
    const source = items.find(source => source.providerType === sourceKey);
    //console.log({items,sourceKey,source});
    if(!source) return false;
    cursor[sourceKey] = source.id;
    await setNutriCursor(chat_id, cursor);
    return  source.id;
}
export const getSourceId = async (chat_id,sourceKey) => {
    const cursor = await getNutriCursor(chat_id);
    if(!cursor[sourceKey]) return setSourceId(chat_id,sourceKey);
    return cursor[sourceKey] || false;
}

export const getWeight = async (chat_id) => {
    await loadCredentials(chat_id);
    const weightSourceId = await getSourceId(chat_id,'Withings');
    if(!weightSourceId) throw new Error('Failed to get weight source id');
    return await baseAPI(`sources/${weightSourceId}/items`);
};
export const getActivities = async (chat_id) => {
    await loadCredentials(chat_id);
    const garminSourceId = await getSourceId(chat_id,'GarminWellness');
    if(!garminSourceId) throw new Error('Failed to get garmin source id');
    return await baseAPI(`sources/${garminSourceId}/items`);
}

export const harvestActivities = async (chat_id) => {
    const {items} = await getActivities(chat_id);
    const activities = items.map(item => {
        delete item.gps;
        const src = "garmin";;
        const {date:timestamp,activity:type,itemId} = item;
        const id = md5(itemId);
        const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
        const saveMe = {chat_id, src, id, date, type, data:item};
        return saveMe;
    });

    return await saveActivities(activities);
}

export const harvestWeight = async (chat_id) => {
    const {items} = await getWeight(chat_id);
    const weights = items.map(item => {
        const src = "withings";
        const {date:timestamp,weight:kg,fatRatio:fat_ratio} = item;
        const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
        const saveMe = {chat_id, src,  date, kg, fat_ratio};
        return saveMe;
    }
    )
    .reduce((acc, item) => {
        const {date,kg} = item;
        if(acc.find(weight => weight.date === date)) return acc;
        return [...acc, item];
    }, []);
    return await saveWeight(weights);
}

const KG_TO_LBS = 2.20462;

export const loadDailyWeight = async (chat_id) => {
  const data = await loadWeight(chat_id, 31 * 6);
  const today = moment().tz(timezone).startOf('day');
  const sixMonthsAgo = today.clone().subtract(6, 'months');
  let days = [];

  for (let m = today; m.isSameOrAfter(sixMonthsAgo); m.subtract(1, 'day')) {
    const formattedDate = m.format('YYYY-MM-DD');
    const weightData = data.find(weight => weight.date === formattedDate) || {};
    days.push({
      date: formattedDate,
      kg: weightData.kg || null,
      measured: !!weightData.kg,
      fat: weightData.fat_ratio || null,
    });
  }

  // Reverse days for chronological order, and ensure boundaries have data
  const earliestValue = data[data.length - 1];
 const latestValue = data[0];
  if (data.length) {
    days[0].kg = days[0].kg || earliestValue.kg;
    days[0].fat = days[0].fat || earliestValue.fat_ratio;
    days[days.length - 1].kg = days[days.length - 1].kg || latestValue.kg;
    days[days.length - 1].fat = days[days.length - 1].fat || latestValue.fat_ratio;
  }
  days.reverse();

  // Interpolate gaps
  let startGapIndex = null;
  for (let i = 0; i < days.length; i++) {
    if (!days[i].kg && startGapIndex === null) {
      startGapIndex = i;
    } else if (days[i].kg && startGapIndex !== null) {
      const dayCount = i - startGapIndex;
      const kgDiff = days[i].kg - days[startGapIndex - 1].kg;
      const fatDiff = days[i].fat - days[startGapIndex - 1].fat;
      for (let j = startGapIndex; j < i; j++) {
        const progress = (j - startGapIndex + 1) / dayCount;
        days[j].kg = days[startGapIndex - 1].kg + progress * kgDiff;
        days[j].fat = days[startGapIndex - 1].fat + progress * fatDiff;
      }
      startGapIndex = null;
    }
  }

        const rollingBasis = 21;
        days = days.map((day, i, arr) => {
            const nearestWeight = 3;
            const furtherWeight = 1;
            const weightStep = (nearestWeight - furtherWeight) / rollingBasis;
            const arrayOfWeights = Array.from({length: rollingBasis}, (_, i) => nearestWeight - i * weightStep);
            const sliceSize = Math.min(rollingBasis, arr.length - i);

            const weightedSum = arr.slice(i, i + sliceSize).reduce((sum, d, j) => {
                const weight = arrayOfWeights[j] || 1; // Use 1 as default weight if it doesn't exist in arrayOfWeights
                return sum + (isNaN(d.kg) ? 0 : d.kg * weight);
            }, 0);

            const weightsSum = arrayOfWeights.slice(0, sliceSize).reduce((sum, weight) => sum + weight, 0);

            return {...day, rollingAvg: parseFloat((weightedSum / weightsSum).toFixed(2))};
        });

    //get rolling average Diff
    days = days.map((day, i, arr) => {
        const sliceSize = Math.min(rollingBasis, arr.length - i);
        const sampleRollingAvg = arr.slice(i, i + sliceSize).reduce((sum, d) => sum + (isNaN(d.rollingAvg) ? 0 : d.rollingAvg), 0) / sliceSize;
        const rollingAvgDiff = parseFloat((day.rollingAvg - sampleRollingAvg).toFixed(2));
        const estimatedKg = parseFloat((day.rollingAvg + rollingAvgDiff).toFixed(2));
        return {...day, rollingAvgDiff, estimatedKg};
    });

    // Define the number of days ago for trend calculation
    const daysAgoToGet = [7, 30];
    days.forEach((day, i, arr) => {
        const todayValue = day.kg;  
        const pastValues = {};
        daysAgoToGet.forEach(daysAgo => {
            let pastDay = (i - daysAgo) >= 0 ? arr[i - daysAgo] : arr[0];
            while (!pastDay?.kg && daysAgo < i) {
                daysAgo--;
                pastDay = (i - daysAgo) >= 0 ? arr[i - daysAgo] : arr[0];
            }
            pastValues[daysAgo] = pastDay?.kg || todayValue;
        });
        day.trend7days = parseFloat((todayValue - pastValues[7]).toFixed(2));
        day.trend30days = parseFloat((todayValue - pastValues[30]).toFixed(2));
    });

  // Add lbs values
  return days.map(day => ({
    date: day.date,
    lbs_measured: day.measured ? parseFloat((day.kg * KG_TO_LBS).toFixed(1)) : null,
    lbs_estimated: parseFloat((day.estimatedKg * KG_TO_LBS).toFixed(1)),
    lbs_trend7days: parseFloat((day.trend7days * KG_TO_LBS).toFixed(2)),
    lbs_trend30days: parseFloat((day.trend30days * KG_TO_LBS).toFixed(2)),
  })).reverse();
};