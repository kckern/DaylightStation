import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile, userLoadFile, userSaveFile, userLoadAuth, userSaveAuth } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';
import { serializeError } from './logging/utils.js';

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();
const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
const defaultStravaLogger = createLogger({
    source: 'backend',
    app: 'strava'
});
const asLogger = (logger) => logger || defaultStravaLogger;

const timezone = process.env.TZ || 'America/Los_Angeles';

export const getAccessToken = async (logger, username = null) => {
    const log = asLogger(logger);
    if (process.env.STRAVA_ACCESS_TOKEN) return process.env.STRAVA_ACCESS_TOKEN;

    const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
    const user = username || getDefaultUsername();
    // Load from user-namespaced auth
    const authData = userLoadAuth(user, 'strava') || {};
    const { refresh } = authData;

    try {
        const tokenResponse = await axios.post('https://www.strava.com/oauth/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refresh,
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;

        if (refreshToken) {
            userSaveAuth(user, 'strava', { refresh: refreshToken });
        }
        process.env.STRAVA_ACCESS_TOKEN = accessToken;
        return accessToken;
    } catch (error) {
        log.error('harvest.strava.access_token.error', { error: serializeError(error) });
        return false;
    }
};

const reauthSequence = async () => {
    const { STRAVA_CLIENT_ID, STRAVA_URL } = process.env;
    //http://www.strava.com/oauth/authorize?client_id=[REPLACE_WITH_YOUR_CLIENT_ID]&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=read
    return {
        url: `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${STRAVA_URL}&approval_prompt=force&scope=read,activity:read_all`
    };
}

const baseAPI = async (endpoint, logger) => {
    const log = asLogger(logger);
    const base_url = `https://www.strava.com/api/v3`;
    const { STRAVA_ACCESS_TOKEN } = process.env;

    try {
        const url = `${base_url}/${endpoint}`;
        const headers = { 'Authorization': `Bearer ${STRAVA_ACCESS_TOKEN}` };

        const dataResponse = await axios.get(url, { headers });
        return dataResponse.data;
    } catch (error) {
        log.warn('harvest.strava.fetch.error', { endpoint, error: serializeError(error), responseData: error.response?.data });
        return false;
    }
};

export const getActivities = async (logger) => {
    const log = asLogger(logger);
    await getAccessToken(logger);

    const activities = [];
    let page = 1;
    const perPage = 100; // Adjust perPage as needed
    const oneYearAgo = moment().subtract(2, 'week').startOf('day');
    const before = moment().startOf('day').unix();
    const after = oneYearAgo.unix();

    while (true) {
        const response = await baseAPI(`athlete/activities?before=${before}&after=${after}&page=${page}&per_page=${perPage}`, logger);
        if (!response) return false;
        activities.push(...response);

        if (response.length < perPage) break; // Stop if fewer items than perPage are returned
        page++;
    }
    const username = getDefaultUsername();
    // Load from user-namespaced path
    const onFileActivities = userLoadFile(username, 'archives/strava_long') || {};
    const activitiesWithHeartRate = await Promise.all(
        activities
        .slice(0, 50)
        .map(async (activity) => {
            if(!activity?.id) return null;
            if (activity.type === 'VirtualRide' || activity.type === 'VirtualRun') {
                activity.heartRateOverTime = [9];
                return activity; // Skip virtual activities
            }
            const onFileActivity = onFileActivities[moment(activity.start_date).tz(timezone).format('YYYY-MM-DD')] || {};
            const alreadyHasHR = onFileActivity[md5(activity.id?.toString())]?.data?.heartRateOverTime || null;
            if(alreadyHasHR) return alreadyHasHR
            try {
                const heartRateResponse = await baseAPI(`activities/${activity.id}/streams?keys=heartrate&key_by_type=true`, logger);
                if (heartRateResponse && heartRateResponse.heartrate) {
                    activity.heartRateOverTime = heartRateResponse.heartrate.data.map((value, index) => {
                        //const time = moment(activity.start_date).add(index, 'seconds').tz(timezone).format('HH:mm:ss');
                        return value;
                    });
                } else {
                    activity.heartRateOverTime = [0];
                }
            } catch (error) {
                log.warn('harvest.strava.heartrate.error', { activityId: activity.id, error: serializeError(error) });
                activity.heartRateOverTime = [1];
            }

            return activity;
        })
    );

    return { items: activitiesWithHeartRate };
};

const harvestActivities = async (logger, job_id) => {
    const log = asLogger(logger);
    try {
        const activitiesData = await getActivities(logger);
        if(!activitiesData) return await reauthSequence();
        log.info('harvest.strava.activities', { jobId: job_id, count: activitiesData.items.length });
        const activities = activitiesData.items.map(item => {
            const src = "strava";
            const { start_date: timestamp, type, id: itemId } = item;
            if(!itemId) return false;
            const id = md5(itemId?.toString());
            const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
            const saveMe = { src, id, date, type, data: item };
            return saveMe;
        }).filter(Boolean);

        const harvestedDates = activities.map(activity => activity.date);
        const username = getDefaultUsername();
        // Load from user-namespaced path
        const onFile = userLoadFile(username, 'strava') || {};
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

        // Save to user-namespaced location
        userSaveFile(username, 'archives/strava_long', saveMe);

        const reducedSaveMe = Object.keys(saveMe).reduce((acc, date) => {
            acc[date] = Object.values(saveMe[date])
                .map(activity => ({
                    title: activity.data.name || '',
                    distance: parseFloat((activity.data.distance || 0).toFixed(2)),
                    minutes: parseFloat((activity.data.moving_time / 60 || 0).toFixed(2)),
                    startTime: activity.data.start_date ? moment(activity.data.start_date).tz(timezone).format('hh:mm a') : '',
                    suffer_score:  parseFloat((activity.data.suffer_score || 0).toFixed(2)),
                    avgHeartrate: parseFloat((activity.data.average_heartrate || 0).toFixed(2)),
                    maxHeartrate: parseFloat((activity.data.max_heartrate || 0).toFixed(2)),
                    heartRateOverTime: activity.data.heartRateOverTime || [],
                }));
            if (acc[date].length === 0) delete acc[date];
            return acc;
        }, {});

        // Save to user-namespaced location
        userSaveFile(username, 'strava', reducedSaveMe);

        return reducedSaveMe;
    } catch (error) {
        log.error('harvest.strava.failure', { jobId: job_id, error: serializeError(error) });
        return { success: false, error: error.message };
    }
};

export default harvestActivities;