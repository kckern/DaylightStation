import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile, userLoadFile, userSaveFile, userLoadAuth, userSaveAuth } from './io.mjs';
import { userDataService } from './config/UserDataService.mjs';
import { configService } from './config/ConfigService.mjs';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';
import { serializeError } from './logging/utils.js';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
const fitsyncLogger = createLogger({ source: 'backend', app: 'fitsync' });

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
            const titleMatch = errorStr.match(/<title>([^<]+)<\/title>/);
            const messageMatch = errorStr.match(/<b>Message<\/b>\s*([^<]+)/);
            const h2Match = errorStr.match(/<h2[^>]*>([^<]+)<\/h2>/);
            
            const parts = [`HTTP ${code} ${type}`];
            if (h2Match && h2Match[1]) parts.push(h2Match[1]);
            if (messageMatch && messageMatch[1]) parts.push(messageMatch[1]);
            
            return parts.join(' - ');
        }
    }
    
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

/**
 * Check if circuit breaker is open (in cooldown)
 * @returns {boolean|Object} false if OK to proceed, or cooldown info object
 */
const isInCooldown = () => {
  if (!circuitBreaker.cooldownUntil) return false;
  if (Date.now() >= circuitBreaker.cooldownUntil) {
    circuitBreaker.cooldownUntil = null;
    circuitBreaker.failures = 0;
    fitsyncLogger.info('fitsync.circuit.reset', { message: 'Cooldown expired, circuit reset' });
    return false;
  }
  const remainingMs = circuitBreaker.cooldownUntil - Date.now();
  return { inCooldown: true, remainingMs, remainingMins: Math.ceil(remainingMs / 60000) };
};

/**
 * Record a failure and potentially open the circuit
 */
const recordFailure = (error) => {
  circuitBreaker.failures++;
  
  if (circuitBreaker.failures >= circuitBreaker.maxFailures) {
    const backoffMultiplier = Math.min(Math.pow(2, circuitBreaker.failures - circuitBreaker.maxFailures), 24);
    const cooldownMs = Math.min(
      circuitBreaker.baseCooldownMs * backoffMultiplier,
      circuitBreaker.maxCooldownMs
    );
    circuitBreaker.cooldownUntil = Date.now() + cooldownMs;
    const cooldownMins = Math.ceil(cooldownMs / 60000);
    fitsyncLogger.warn('fitsync.circuit.open', {
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
    fitsyncLogger.info('fitsync.circuit.success', { previousFailures: circuitBreaker.failures });
  }
  circuitBreaker.failures = 0;
  circuitBreaker.cooldownUntil = null;
};

// Get default username for legacy single-user access
const getDefaultUsername = () => {
  // Use head of household from config (never hardcode usernames)
  return configService.getHeadOfHousehold();
};




export const getAccessToken = async () => {
    // Check for cached token
    if(process.env.FITSYNC_ACCESS_TOKEN) return process.env.FITSYNC_ACCESS_TOKEN;

    // Get credentials from ConfigService
    const FITSYNC_CLIENT_ID = configService.getSecret('FITSYNC_CLIENT_ID') || process.env.FITSYNC_CLIENT_ID;
    const FITSYNC_CLIENT_SECRET = configService.getSecret('FITSYNC_CLIENT_SECRET') || process.env.FITSYNC_CLIENT_SECRET;
    
    if (!FITSYNC_CLIENT_ID || !FITSYNC_CLIENT_SECRET) {
        fitsyncLogger.error('fitsync.auth.credentials_missing', { 
            message: 'FITSYNC_CLIENT_ID or FITSYNC_CLIENT_SECRET not configured' 
        });
        return false;
    }

    const username = getDefaultUsername();
    const authData = userLoadAuth(username, 'fitnesssyncer') || {};
    const { refresh } = authData;
    
    if (!refresh) {
        fitsyncLogger.error('fitsync.auth.missing', { 
            message: 'No refresh token found',
            username,
            suggestion: 'Run OAuth flow to obtain refresh token'
        });
        return false;
    }

    try {
        const tokenResponse = await axios.post('https://www.fitnesssyncer.com/api/oauth/access_token', 
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refresh,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;
        
        if (refreshToken) {
            userSaveAuth(username, 'fitnesssyncer', { refresh: refreshToken });
        }
        
        process.env.FITSYNC_ACCESS_TOKEN = accessToken;
        fitsyncLogger.info('fitsync.auth.token_refreshed', { username });
        return accessToken;
    } catch (error) {
        const cleanError = cleanErrorMessage(error);
        fitsyncLogger.error('fitsync.auth.token_refresh_failed', { 
            error: cleanError,
            statusCode: error.response?.status,
            username
        });
        
        // Record failure for rate limiting
        if (error.response?.status === 429) {
            recordFailure(error);
        }
        
        return false;
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
        const isRateLimit = error.response?.status === 429;
        
        if (isRateLimit) {
            recordFailure(error);
            fitsyncLogger.warn('fitsync.rate_limit', { 
                endpoint,
                statusCode: 429,
                message: 'Rate limit exceeded'
            });
        } else {
            fitsyncLogger.error('fitsync.fetch.failed', { 
                endpoint,
                error: cleanErrorMessage(error),
                statusCode: error.response?.status
            });
        }
        
        throw error;
    }
};




export const setSourceId = async (sourceKey) => {
const { items } = await baseAPI('sources');
const source = items.find(source => source.providerType === sourceKey);
if (!source) return false;
return source.id;
};

export const getSourceId = async (sourceKey) => {
 const { items } = await baseAPI('sources');
 const source = items.find(source => source.providerType === sourceKey);
 if (!source) return false;
 return source.id;
};

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

const harvestActivities = async (job_id) => {
    // Check circuit breaker before attempting harvest
    const cooldownStatus = isInCooldown();
    if (cooldownStatus) {
        fitsyncLogger.debug('fitsync.harvest.skipped', {
            jobId: job_id,
            reason: 'Circuit breaker active',
            remainingMins: cooldownStatus.remainingMins
        });
        return { skipped: true, reason: 'cooldown', remainingMins: cooldownStatus.remainingMins };
    }

    try {
        const username = getDefaultUsername();
        const activitiesData = await getActivities();
        
        if (!activitiesData || !activitiesData.items) {
            throw new Error('No activity data returned from FitnessSyncer API');
        }
        
        fitsyncLogger.info('fitsync.harvest.activities', { 
            jobId: job_id, 
            count: activitiesData.items.length 
        });
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
    // Load from user-namespaced path
    const onFile = userLoadFile(username, 'fitness') || {};
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
    userSaveFile(username, 'archives/fitness_long', saveMe);
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
            .reduce((sum, activity) => sum + (activity.data.duration/60 || 0), 0)
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
            minutes: parseFloat((activity.data.duration/60 || 0).toFixed(2)),
            startTime: activity.data.date ? moment(activity.data.date).tz(timezone).format('hh:mm a') : '',
            endTime: activity.data.endDate ? moment(activity.data.endDate).tz(timezone).format('hh:mm a') : '',
            avgHeartrate: parseFloat((activity.data.avgHeartrate || 0).toFixed(2)),
            })),
        };
        if(acc[date].activities.length === 0) delete acc[date].activities;
        return acc;
    }, {});
    // Save to user-namespaced location
    userSaveFile(username, 'fitness', reducedSaveMe);
    
    // Success! Reset circuit breaker
    recordSuccess();
    fitsyncLogger.info('fitsync.harvest.complete', { 
        jobId: job_id,
        dates: Object.keys(reducedSaveMe).length,
        username 
    });
    
    return reducedSaveMe;
} catch (error) {
    // Record failure for circuit breaker on rate limit errors
    const isRateLimit = error.response?.status === 429 || 
                       error.message?.includes('429') || 
                       error.message?.includes('Rate limit');
    const isAuthError = error.response?.status === 401 || error.response?.status === 403;
    
    if (isRateLimit || isAuthError) {
        recordFailure(error);
    }
    
    fitsyncLogger.error('fitsync.harvest.failed', { 
        jobId: job_id,
        error: cleanErrorMessage(error),
        statusCode: error.response?.status
    });
    
    return { success: false, error: cleanErrorMessage(error) };
}
};

export { isInCooldown as isFitsyncInCooldown };
export default harvestActivities;