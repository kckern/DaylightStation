import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile } from './io.mjs';
import axios from 'axios';
const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

const timezone = 'America/Los_Angeles';


export const getTokensFromCode = async (code) => {
    const {FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET} = process.env;
    process.exit(console.log({ FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET }));
    const redirect_uri = 'https://personal.fitnesssyncer.com/';
    const link = `https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=${redirect_uri}&state=InformationForYourService`;
    if(!code) process.exit(console.log(link));

    try {
        const tokenResponse = await axios.post('https://api.fitnesssyncer.com/api/oauth/access_token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET,
                redirect_uri: redirect_uri
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return tokenResponse.data;
    } catch (error) {
        console.error(`Try this link: ${link}`);
        throw error;
    }
};

export const getAccessTokenFromRefreshToken = async (refresh_token) => {
    const {FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET} = process.env;
    try {
        const tokenResponse = await axios.post('https://www.fitnesssyncer.com/api/oauth/access_token', 
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refresh_token,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        console.log({ tokenData: tokenResponse.data });
        return tokenResponse.data;
    } catch (error) {
        console.error('Failed to get access token from refresh token.');
        process.exit(console.log(`https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=https://personal.fitnesssyncer.com/&state=InformationForYourService`));
        throw error;
    }
};

const baseAPI = async (endpoint) => {
    const base_url = `https://api.fitnesssyncer.com/api/providers`;
    const {FITSYNC_ACCESS_TOKEN} = process.env;
    try {
        const url = `${base_url}/${endpoint}`;
        const headers = { 'Authorization': `Bearer ${FITSYNC_ACCESS_TOKEN}` };
        const dataResponse = await axios.get(url, { headers });
        return dataResponse.data;
    } catch (error) {
        console.error(`Error fetching data from ${endpoint}:`, error);
        throw error;
    }
};


export const loadCredentials = async () => {
    
    const FITSYNC_ACCESS_TOKEN = loadFile('credentials/fitsync_access_token');
    if (FITSYNC_ACCESS_TOKEN) {
        process.env.FITSYNC_ACCESS_TOKEN = FITSYNC_ACCESS_TOKEN;
        return true;
    }
    
    const FITSYNC_REFRESH_TOKEN = loadFile('credentials/fitsync_refresh_token');
    if (!FITSYNC_REFRESH_TOKEN) {
        console.log(`https://www.fitnesssyncer.com/api/oauth/authorize?client_id=${process.env.FITSYNC_CLIENT_ID}&response_type=code&scope=Sources&redirect_uri=https://personal.fitnesssyncer.com/&state=InformationForYourService`);
        return false;
    }
    const { access_token, refresh_token } = await getAccessTokenFromRefreshToken(FITSYNC_REFRESH_TOKEN);
    process.env.FITSYNC_ACCESS_TOKEN = access_token;
    process.env.FITSYNC_REFRESH_TOKEN = refresh_token;
    saveFile(`credentials/fitsync_access_token`, access_token);
    saveFile(`credentials/fitsync_refresh_token`, refresh_token);
    return true;
};

export const setSourceId = async (sourceKey) => {
    const { items } = await baseAPI('sources');
    const source = items.find(source => source.providerType === sourceKey);
    if (!source) return false;
    return source.id;
};

export const getSourceId = async (sourceKey) => {
    return await setSourceId(sourceKey);
};

export const getActivities = async () => {
    await loadCredentials();
    const garminSourceId = await getSourceId('GarminWellness');
    if (!garminSourceId) throw new Error('Failed to get garmin source id');
    return await baseAPI(`sources/${garminSourceId}/items`);
};

export const harvestActivities = async () => {
    try {
        const { items } = await getActivities();
    } catch (error) {
        console.error('Failed to get activities:', error);
        process.exit(1);
    }
    const activities = items.map(item => {
        delete item.gps;
        const src = "garmin";
        const { date: timestamp, activity: type, itemId } = item;
        const id = md5(itemId);
        const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
        const saveMe = { src, id, date, type, data: item };
        return saveMe;
    });

    return saveFile('lifelog/fitness', activities);
};

