import garmin from 'garmin-connect';
const { GarminConnect } = garmin;
import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile, userLoadFile, userSaveFile, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
const timezone = process.env.TZ || 'America/Los_Angeles';

/**
 * Extract clean error message from HTML error responses
 * @param {Error} error
 * @returns {string} Clean error message
 */
const cleanErrorMessage = (error) => {
    const errorStr = error?.message || String(error);
    
    // Check for HTML in error message
    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html')) {
        // Extract error code and type
        const codeMatch = errorStr.match(/ERROR:\s*\((\d+)\),\s*([^,"]+)/);
        if (codeMatch) {
            const [, code, type] = codeMatch;
            // Try to extract meaningful message from HTML
            const titleMatch = errorStr.match(/<title>([^<]+)<\/title>/);
            const messageMatch = errorStr.match(/<b>Message<\/b>\s*([^<]+)/);
            const h2Match = errorStr.match(/<h2[^>]*>([^<]+)<\/h2>/);
            
            const parts = [`HTTP ${code} ${type}`];
            if (h2Match && h2Match[1]) parts.push(h2Match[1]);
            if (messageMatch && messageMatch[1]) parts.push(messageMatch[1]);
            
            return parts.join(' - ');
        }
    }
    
    // Return original if not HTML or couldn't extract
    return errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
};

// Circuit breaker state for rate limiting resilience
const circuitBreaker = {
  failures: 0,
  cooldownUntil: null,
  maxFailures: 3,
  baseCooldownMs: 5 * 60 * 1000, // 5 minutes
  maxCooldownMs: 2 * 60 * 60 * 1000, // 2 hours max
};

const garminLogger = createLogger({ source: 'backend', app: 'garmin' });

// Lazy-loaded Garmin client (per user)
let _garminClient = null;
let _garminUsername = null;

/**
 * Get Garmin client, lazy-initialized with user credentials
 * @param {string} [targetUsername] - Optional username override
 * @returns {GarminConnect}
 */
const getGarminClient = (targetUsername = null) => {
    const username = targetUsername || getDefaultUsername();
    
    // If client exists for same user, reuse it
    if (_garminClient && _garminUsername === username) {
        return _garminClient;
    }
    
    // Load credentials from user auth file (with env fallback)
    const auth = configService.getUserAuth('garmin', username) || {};
    const garminUser = auth.username || configService.getSecret('GARMIN_USERNAME');
    const garminPass = auth.password || configService.getSecret('GARMIN_PASSWORD');
    
    if (!garminUser || !garminPass) {
        throw new Error(`Garmin credentials not found for user: ${username}`);
    }
    
    _garminClient = new GarminConnect({
        username: garminUser,
        password: garminPass,
    });
    _garminUsername = username;
    
    return _garminClient;
};

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

/**
 * Check if circuit breaker is open (in cooldown)
 * @returns {boolean|Object} false if OK to proceed, or cooldown info object
 */
const isInCooldown = () => {
  if (!circuitBreaker.cooldownUntil) return false;
  if (Date.now() >= circuitBreaker.cooldownUntil) {
    // Cooldown expired, reset
    circuitBreaker.cooldownUntil = null;
    circuitBreaker.failures = 0;
    garminLogger.info('garmin.circuit.reset', { message: 'Cooldown expired, circuit reset' });
    return false;
  }
  const remainingMs = circuitBreaker.cooldownUntil - Date.now();
  return { inCooldown: true, remainingMs, remainingMins: Math.ceil(remainingMs / 60000) };
};

/**
 * Record a failure and potentially open the circuit
 * @param {Error} error
 */
const recordFailure = (error) => {
  circuitBreaker.failures++;
  
  // Check if we should enter cooldown
  if (circuitBreaker.failures >= circuitBreaker.maxFailures) {
    // Exponential backoff: 5min, 10min, 20min, 40min... up to 2 hours
    const backoffMultiplier = Math.min(Math.pow(2, circuitBreaker.failures - circuitBreaker.maxFailures), 24);
    const cooldownMs = Math.min(
      circuitBreaker.baseCooldownMs * backoffMultiplier,
      circuitBreaker.maxCooldownMs
    );
    circuitBreaker.cooldownUntil = Date.now() + cooldownMs;
    const cooldownMins = Math.ceil(cooldownMs / 60000);
    garminLogger.warn('garmin.circuit.open', {
      failures: circuitBreaker.failures,
      cooldownMins,
      reason: cleanErrorMessage(error),
      resumeAt: new Date(circuitBreaker.cooldownUntil).toISOString()
    });
  }
};

/**
 * Record a success and reset the circuit breaker
 */
const recordSuccess = () => {
  if (circuitBreaker.failures > 0) {
    garminLogger.info('garmin.circuit.success', { previousFailures: circuitBreaker.failures });
  }
  circuitBreaker.failures = 0;
  circuitBreaker.cooldownUntil = null;
};

const login = async () => {
    try {
        await getGarminClient().login();
    } catch (e) {
        // Log clean error message without HTML dumps
        const cleanError = cleanErrorMessage(e);
        garminLogger.error('garmin.login.error', { error: cleanError });
        throw e;
    }
};




export const getActivities = async (start = 0, limit = 100, activityType, subActivityType) => {
    await login();
    const activities = await getGarminClient().getActivities(start, limit, activityType, subActivityType);
    return activities;
};

export const getActivityDetails = async (activityId) => {
    await login();
    const activityDetails = await getGarminClient().getActivity({ activityId });
    return activityDetails;
};

export const downloadActivityData = async (activityId, directoryPath = './') => {
    await login();
    const activity = await getGarminClient().getActivity({ activityId });
    await getGarminClient().downloadOriginalActivityData(activity, directoryPath);
};

export const uploadActivityFile = async (filePath) => {
    await login();
    const uploadResult = await getGarminClient().uploadActivity(filePath);
    return uploadResult;
};

export const uploadActivityImage = async (activityId, imagePath) => {
    await login();
    const activity = await getGarminClient().getActivity({ activityId });
    const uploadResult = await getGarminClient().uploadImage(activity, imagePath);
    return uploadResult;
};

export const deleteActivityImage = async (activityId, imageId) => {
    await login();
    const activity = await getGarminClient().getActivity({ activityId });
    await getGarminClient().deleteImage(activity, imageId);
};

export const getSteps = async (date = new Date()) => {
    await login();
    const steps = await getGarminClient().getSteps(date);
    return steps;
};


export const getHeartRate = async (date = new Date()) => {
    await login();
    const heartRateData = await getGarminClient().getHeartRate(date);
    return heartRateData;
};

const harvestActivities = async () => {
    // Check circuit breaker before attempting harvest
    const cooldownStatus = isInCooldown();
    if (cooldownStatus) {
        garminLogger.debug('garmin.harvest.skipped', {
            reason: 'Circuit breaker active',
            remainingMins: cooldownStatus.remainingMins
        });
        return { skipped: true, reason: 'cooldown', remainingMins: cooldownStatus.remainingMins };
    }

    try {
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
        
        // Success! Reset circuit breaker
        recordSuccess();
        return saveMe;
    } catch (error) {
        // Record failure for circuit breaker
        recordFailure(error);
        throw error;
    }
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

export { isInCooldown as isGarminInCooldown };
export default harvestActivities;