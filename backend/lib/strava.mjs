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
    defaultStravaLogger.info('strava.circuit.reset', { message: 'Cooldown expired, circuit reset' });
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
    defaultStravaLogger.warn('strava.circuit.open', {
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
    defaultStravaLogger.info('strava.circuit.success', { previousFailures: circuitBreaker.failures });
  }
  circuitBreaker.failures = 0;
  circuitBreaker.cooldownUntil = null;
};

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
        const expiresAt = tokenResponse.data.expires_at;

        if (refreshToken) {
            // Merge with existing auth data to preserve other fields
            const newAuthData = { 
                ...authData,
                refresh: refreshToken,
                access_token: accessToken,
                expires_at: expiresAt
            };
            userSaveAuth(user, 'strava', newAuthData);
        }
        process.env.STRAVA_ACCESS_TOKEN = accessToken;
        return accessToken;
    } catch (error) {
        log.error('harvest.strava.access_token.error', { 
            error: cleanErrorMessage(error),
            statusCode: error.response?.status 
        });
        return false;
    }
};

export const reauthSequence = async () => {
    const { STRAVA_CLIENT_ID, STRAVA_URL } = process.env;
    const redirectUri = STRAVA_URL || 'http://localhost:3000/api/auth/strava/callback';
    return {
        url: `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&approval_prompt=force&scope=read,activity:read_all`
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
        if (error.response && error.response.status === 429) {
            recordFailure(error);
            log.warn('strava.rate_limit', { 
                endpoint, 
                statusCode: 429,
                message: 'Rate limit exceeded'
            });
            throw error;
        }
        log.warn('harvest.strava.fetch.error', { 
            endpoint, 
            error: cleanErrorMessage(error),
            statusCode: error.response?.status,
            responseData: error.response?.data 
        });
        return false;
    }
};

export const getActivities = async (logger, daysBack = 90) => {
    const log = asLogger(logger);
    await getAccessToken(logger);

    const activities = [];
    let page = 1;
    const perPage = 100; // Adjust perPage as needed
    const startTime = moment().subtract(daysBack, 'days').startOf('day');
    const before = moment().startOf('day').unix();
    const after = startTime.unix();

    while (true) {
        const response = await baseAPI(`athlete/activities?before=${before}&after=${after}&page=${page}&per_page=${perPage}`, logger);
        if (!response) return false;
        activities.push(...response);

        if (response.length < perPage) break; // Stop if fewer items than perPage are returned
        page++;
    }
    const username = getDefaultUsername();
    
    const activitiesWithHeartRate = [];
    
    // Process sequentially to avoid rate limits
    for (const activity of activities) {
        if(!activity?.id) continue;
        
        if (activity.type === 'VirtualRide' || activity.type === 'VirtualRun') {
            activity.heartRateOverTime = [9];
            activitiesWithHeartRate.push(activity);
            continue;
        }

        // Check if we already have this activity on file (new structure)
        const date = moment(activity.start_date).tz(timezone).format('YYYY-MM-DD');
        const existingFile = userLoadFile(username, `strava/${date}_${activity.id}`);
        
        if (existingFile && existingFile.data && existingFile.data.heartRateOverTime) {
            activitiesWithHeartRate.push(existingFile.data);
            continue;
        }

        // Fallback to checking legacy archive (optional, but good for transition)
        const onFileActivities = userLoadFile(username, 'archives/strava_long') || {};
        const onFileActivity = onFileActivities[date] || {};
        const alreadyHasHR = onFileActivity[md5(activity.id?.toString())]?.data?.heartRateOverTime || null;
        
        if(alreadyHasHR) {
            activity.heartRateOverTime = alreadyHasHR;
            activitiesWithHeartRate.push(activity);
            continue;
        }

        try {
            // Rate limit meter: Sleep 5 seconds before fetching streams
            // 200 requests / 15 mins = ~1 request every 4.5 seconds.
            await new Promise(resolve => setTimeout(resolve, 5000));

            const heartRateResponse = await baseAPI(`activities/${activity.id}/streams?keys=heartrate&key_by_type=true`, logger);
            if (heartRateResponse && heartRateResponse.heartrate) {
                activity.heartRateOverTime = heartRateResponse.heartrate.data.map((value, index) => {
                    return value;
                });
            } else {
                activity.heartRateOverTime = [0];
            }
        } catch (error) {
            log.warn('harvest.strava.heartrate.error', { 
                activityId: activity.id, 
                error: cleanErrorMessage(error),
                statusCode: error.response?.status 
            });
            activity.heartRateOverTime = [1];
            
            // If rate limit hit, re-throw to let caller handle it (or just let it fail and script will catch)
            if (error.response && error.response.status === 429) {
                throw error;
            }
        }
        activitiesWithHeartRate.push(activity);
    }

    return { items: activitiesWithHeartRate };
};

const harvestActivities = async (logger, job_id, daysBack = 90) => {
    const log = asLogger(logger);
    
    // Check circuit breaker before attempting harvest
    const cooldownStatus = isInCooldown();
    if (cooldownStatus) {
        log.debug('strava.harvest.skipped', {
            jobId: job_id,
            reason: 'Circuit breaker active',
            remainingMins: cooldownStatus.remainingMins
        });
        return { skipped: true, reason: 'cooldown', remainingMins: cooldownStatus.remainingMins };
    }

    try {
        const activitiesData = await getActivities(logger, daysBack);
        if(!activitiesData) return await reauthSequence();
        
        // Filter out any nulls from getActivities
        const validItems = (activitiesData.items || []).filter(Boolean);
        
        log.info('harvest.strava.activities', { jobId: job_id, count: validItems.length });
        if (validItems.length > 0) {
            log.info('harvest.strava.sample', { sample: validItems[0] });
        }
        
        const activities = validItems.map(item => {
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
        
        // Save individual activity files
        activities.forEach(activity => {
            if (activity.data && activity.data.id) {
                userSaveFile(username, `strava/${activity.date}_${activity.data.id}`, activity);
            }
        });

        // Load existing FULL data to preserve history (deprecated but kept for now if needed, or we can just rely on individual files + summary)
        // For the summary, we should ideally load the existing summary and merge, or rebuild from individual files if we want to be pure.
        // But since we are "re-harvesting from scratch" or at least the user asked to, we might just want to update the summary with what we have.
        // However, to preserve history not in the current fetch window, we need to load existing summary.
        
        const existingSummary = userLoadFile(username, 'strava') || {};
        
        // Merge new activities into summary structure
        const newSummary = { ...existingSummary };

        // Clean up legacy data: remove entries without IDs or with heartRateOverTime
        Object.keys(newSummary).forEach(date => {
            if (Array.isArray(newSummary[date])) {
                newSummary[date] = newSummary[date].filter(a => a.id && !a.heartRateOverTime);
                if (newSummary[date].length === 0) delete newSummary[date];
            }
        });

        log.info('harvest.strava.summary.start', { activityCount: activities.length });
        activities.forEach(activity => {
            const date = activity.date;
            if (!newSummary[date]) newSummary[date] = [];
            
            // Create lightweight summary object
            const summaryObj = {
                id: activity.data.id,
                title: activity.data.name || '',
                type: activity.type,
                startTime: activity.data.start_date ? moment(activity.data.start_date).tz(timezone).format('hh:mm a') : '',
                distance: parseFloat((activity.data.distance || 0).toFixed(2)),
                minutes: parseFloat((activity.data.moving_time / 60 || 0).toFixed(2)),
                calories: activity.data.calories || activity.data.kilojoules || 0,
                avgHeartrate: parseFloat((activity.data.average_heartrate || 0).toFixed(2)),
                maxHeartrate: parseFloat((activity.data.max_heartrate || 0).toFixed(2)),
                suffer_score: parseFloat((activity.data.suffer_score || 0).toFixed(2)),
                device_name: activity.data.device_name || ''
            };

            // Remove zero/empty/null values
            Object.keys(summaryObj).forEach(key => {
                if (summaryObj[key] === 0 || summaryObj[key] === '' || summaryObj[key] === null) {
                    delete summaryObj[key];
                }
            });

            // Check if activity already exists in summary for this date
            const existingIndex = newSummary[date].findIndex(a => a.id === summaryObj.id);
            if (existingIndex >= 0) {
                newSummary[date][existingIndex] = summaryObj;
            } else {
                newSummary[date].push(summaryObj);
            }
        });

        // Sort dates
        const sortedDates = Object.keys(newSummary).sort((a, b) => new Date(b) - new Date(a));
        const finalSummary = {};
        sortedDates.forEach(date => {
            if (newSummary[date].length > 0) {
                finalSummary[date] = newSummary[date];
            }
        });

        // Save to user-namespaced location
        userSaveFile(username, 'strava', finalSummary);

        // Success! Reset circuit breaker
        recordSuccess();
        return finalSummary;
    } catch (error) {
        // Record failure for circuit breaker on rate limit errors
        if (error.response && (error.response.status === 429 || error.response.status === 401)) {
            recordFailure(error);
            throw error;
        }
        log.error('harvest.strava.failure', { 
            jobId: job_id, 
            error: cleanErrorMessage(error),
            statusCode: error.response?.status
        });
        return { success: false, error: cleanErrorMessage(error) };
    }
};

export { isInCooldown as isStravaInCooldown };
export default harvestActivities;