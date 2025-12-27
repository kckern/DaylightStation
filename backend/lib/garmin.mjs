import garmin from 'garmin-connect';
const { GarminConnect } = garmin;
import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile, userLoadFile, userSaveFile } from './io.mjs';
import { configService } from './config/ConfigService.mjs';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
const timezone = process.env.TZ || 'America/Los_Angeles';

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();

const GCClient = new GarminConnect({
  username: configService.getSecret('GARMIN_USERNAME'),
  password: configService.getSecret('GARMIN_PASSWORD'),
});

// Workaround for garmin-connect issue with form-data
// See: https://github.com/motdotla/dotenv/issues/133#issuecomment-255298822
// The error "Cannot read properties of undefined (reading 'name')" usually happens 
// when the library tries to construct a form-data object but something is missing.
// However, for simple fetching, we might not need to fix the library internals 
// if we are just logging in and fetching JSON.
//
// If login fails or throws this error, it might be due to how the library handles 
// the login response or cookies.
//
// Let's try to wrap the login to catch this specific error if it's non-fatal, 
// or ensure we are using it correctly.

const login = async () => {
    try {
        await GCClient.login();
    } catch (e) {
        // Sometimes login throws but session is established? 
        // Or it's a specific error we can ignore?
        // The error stack trace points to FormData, which suggests it might be trying to upload something?
        // Or maybe the login request itself uses FormData.
        console.error("Garmin login error:", e);
        throw e;
    }
};




export const getActivities = async (start = 0, limit = 100, activityType, subActivityType) => {
    await login();
    const activities = await GCClient.getActivities(start, limit, activityType, subActivityType);
    return activities;
};

export const getActivityDetails = async (activityId) => {
    await login();
    const activityDetails = await GCClient.getActivity({ activityId });
    return activityDetails;
};

export const downloadActivityData = async (activityId, directoryPath = './') => {
    await login();
    const activity = await GCClient.getActivity({ activityId });
    await GCClient.downloadOriginalActivityData(activity, directoryPath);
};

export const uploadActivityFile = async (filePath) => {
    await login();
    const uploadResult = await GCClient.uploadActivity(filePath);
    return uploadResult;
};

export const uploadActivityImage = async (activityId, imagePath) => {
    await login();
    const activity = await GCClient.getActivity({ activityId });
    const uploadResult = await GCClient.uploadImage(activity, imagePath);
    return uploadResult;
};

export const deleteActivityImage = async (activityId, imageId) => {
    await login();
    const activity = await GCClient.getActivity({ activityId });
    await GCClient.deleteImage(activity, imageId);
};

export const getSteps = async (date = new Date()) => {
    await login();
    const steps = await GCClient.getSteps(date);
    return steps;
};


export const getHeartRate = async (date = new Date()) => {
    await login();
    const heartRateData = await GCClient.getHeartRate(date);
    return heartRateData;
};

const harvestActivities = async () => {
    // Fetch more activities to cover 90 days
    // Assuming 100 activities covers 90 days for most users, but we can loop if needed.
    // For now, increasing limit to 200 to be safe.
    const activities = await getActivities(0, 200);
    const username = getDefaultUsername();

    const allDates = activities.map(act => moment.tz(act.startTimeLocal, timezone).format('YYYY-MM-DD'));
    const uniqueDates = [...new Set(allDates)].sort().reverse();
    const saveMe1 = uniqueDates.reduce((obj, date) => {
        obj[date] = obj[date] || [];
        const activitiesForDate = activities.filter(act => moment.tz(act.startTimeLocal, timezone).format('YYYY-MM-DD') === date).map(simplifyActivity);
        obj[date].push(...activitiesForDate);
        return obj;
    }
    , {});
    // Load from user-namespaced path
    const existing = userLoadFile(username, 'garmin') || {};
    const merged = {...existing, ...saveMe1};
    const saveMe = Object.keys(merged)
        .filter(key => moment(key, 'YYYY-MM-DD', true).isValid()) // Ensure the key is a valid date
        .sort()
        .reverse()
        .reduce((obj, key) => {
            obj[key] = merged[key];
            return obj;
        }, {});
    // Save to user-namespaced location
    userSaveFile(username, 'garmin', saveMe);
    return saveMe;
};

//simplifyActivity
const simplifyActivity = (activity) => {

    return {
        date: moment.tz(activity.startTimeLocal, timezone).format('YYYY-MM-DD'),
        activityId: activity.activityId,
        activityName: activity.activityName,
        distance: activity.distance,
        duration: parseInt(activity.duration / 60), // convert to minutes
        movingDuration: parseInt(activity.movingDuration / 60), // convert to minutes
        averageSpeed: activity.averageSpeed,
        calories: activity.calories,
        bmrCalories: activity.bmrCalories,
        averageHR: activity.averageHR,
        maxHR: activity.maxHR,
        steps: activity.steps,
        sets: activity.summarizedExerciseSets?.map(set => {
            const minutes = (set.duration / 1000 / 60).toFixed(0);
            const stringcat = set.category.replace(/_/g, ' ').toLowerCase().replace("unknown", "active motion");
            return `${minutes}m of ${stringcat} (${set.reps} reps in ${set.sets} sets)`;
        }),
        totalSets: activity.totalSets,
        totalReps: activity.totalReps,
        hrZones: [
            parseInt(activity.hrTimeInZone_1 / 60), // convert to minutes
            parseInt(activity.hrTimeInZone_2 / 60), // convert to minutes
            parseInt(activity.hrTimeInZone_3 / 60), // convert to minutes
            parseInt(activity.hrTimeInZone_4 / 60), // convert to minutes
            parseInt(activity.hrTimeInZone_5 / 60)  // convert to minutes
        ]
    };
};

export default harvestActivities;