import moment from 'moment-timezone';
import crypto from 'crypto';
import { loadFile, saveFile, userLoadFile, userSaveFile, userSaveAuth } from './io.mjs';
import { userDataService } from '../../src/0_system/config/UserDataService.mjs';
import { configService } from './config/index.mjs';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';
import { serializeError } from './logging/utils.js';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
const fitsyncLogger = createLogger({ source: 'backend', app: 'fitsync' });

const timezone = process.env.TZ || 'America/Los_Angeles';
const tokenBufferSeconds = 60; // refresh 1 minute before expiry
const accessTokenCache = {
    token: null,
    expiresAt: null
};

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
    const now = moment();
    const isCachedValid = () => accessTokenCache.token && accessTokenCache.expiresAt && now.isBefore(accessTokenCache.expiresAt);

    if (isCachedValid()) {
        fitsyncLogger.debug('fitsync.auth.cache_hit', { expiresAt: accessTokenCache.expiresAt.toISOString() });
        return accessTokenCache.token;
    }

    // Accept env token only if paired with a future expiry
    if (process.env.FITSYNC_ACCESS_TOKEN && process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT) {
        const envExpiry = moment(process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT);
        if (envExpiry.isValid() && envExpiry.isAfter(now)) {
            accessTokenCache.token = process.env.FITSYNC_ACCESS_TOKEN;
            accessTokenCache.expiresAt = envExpiry;
            fitsyncLogger.debug('fitsync.auth.env_token_reused', { expiresAt: envExpiry.toISOString() });
            return accessTokenCache.token;
        }
    }

    const username = getDefaultUsername();
    // Load auth fresh from disk (not cached ConfigService) to get latest tokens
    const authData = loadFile(`users/${username}/auth/fitnesssyncer`) || {};
    const { refresh, client_id, client_secret } = authData;
    
    // Get credentials from user auth file (personal OAuth app)
    const FITSYNC_CLIENT_ID = client_id || configService.getSecret('FITSYNC_CLIENT_ID') || process.env.FITSYNC_CLIENT_ID;
    const FITSYNC_CLIENT_SECRET = client_secret || configService.getSecret('FITSYNC_CLIENT_SECRET') || process.env.FITSYNC_CLIENT_SECRET;
    
    if (!FITSYNC_CLIENT_ID || !FITSYNC_CLIENT_SECRET) {
        fitsyncLogger.error('fitsync.auth.credentials_missing', { 
            message: 'FITSYNC_CLIENT_ID or FITSYNC_CLIENT_SECRET not configured in user auth file',
            username 
        });
        return false;
    }
    
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
        const expiresInSeconds = tokenResponse.data.expires_in || 3600; // FitnessSyncer default is 1 hour
        const expiresAt = moment().add(Math.max(60, expiresInSeconds - tokenBufferSeconds), 'seconds');
        
        const nextRefreshToken = refreshToken || refresh;
        if (nextRefreshToken) {
            // Preserve any existing auth fields while updating tokens/credentials
            // Use expires_at (absolute timestamp) for accurate expiry tracking across restarts
            userSaveAuth(username, 'fitnesssyncer', {
                ...authData,
                refresh: nextRefreshToken,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET,
                expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString()
            });
        }

        accessTokenCache.token = accessToken;
        accessTokenCache.expiresAt = expiresAt;
        process.env.FITSYNC_ACCESS_TOKEN = accessToken;
        process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT = expiresAt.toISOString();
        fitsyncLogger.info('fitsync.auth.token_refreshed', { username, expiresAt: expiresAt.toISOString() });
        return accessToken;
    } catch (error) {
        const cleanError = cleanErrorMessage(error);
        fitsyncLogger.error('fitsync.auth.token_refresh_failed', { 
            error: cleanError,
            statusCode: error.response?.status,
            username
        });
        accessTokenCache.token = null;
        accessTokenCache.expiresAt = null;
        delete process.env.FITSYNC_ACCESS_TOKEN;
        delete process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT;
        
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
    const username = getDefaultUsername();
    let totalFetched = 0;

    // Load existing file for incremental merge
    let onFile = userLoadFile(username, 'archives/fitness_long') || {};

    // Find latest date on file
    let latestDate = null;
    const allDates = Object.keys(onFile).filter(d => moment(d, 'YYYY-MM-DD', true).isValid());
    if (allDates.length > 0) {
        latestDate = allDates.sort((a, b) => moment(b).diff(moment(a)))[0];
    }
    // Anchor fetch to 7 days before latest
    const anchorDate = latestDate ? moment(latestDate).subtract(7, 'days').startOf('day') : moment().subtract(1, 'year').startOf('day');

    fitsyncLogger.info('fitsync.harvest.start', {
        anchorDate: anchorDate.toISOString(),
        latestDate,
        username
    });

    while (true) {
        fitsyncLogger.info('fitsync.harvest.page', {
            offset,
            limit,
            anchorDate: anchorDate.toISOString()
        });
        const response = await baseAPI(`sources/${garminSourceId}/items?offset=${offset}&limit=${limit}`);
        const items = response.items || [];
        if (items.length === 0) break;

        const filteredItems = items.filter(item => moment(item.date).isAfter(anchorDate));
        activities.push(...filteredItems);
        totalFetched += filteredItems.length;

        // Merge new items into onFile and write incrementally
        const newActivities = filteredItems.map(item => {
            delete item.gps;
            const src = "garmin";
            const { date: timestamp, activity: type, itemId } = item;
            const id = md5(itemId);
            const date = moment(timestamp).tz(timezone).format('YYYY-MM-DD');
            // Only accept valid dates in range
            if (!moment(date, 'YYYY-MM-DD', true).isValid() || moment(date).isBefore('2000-01-01') || moment(date).isAfter(moment().add(1, 'day'))) {
                fitsyncLogger.warn('fitsync.invalid_date', { date, itemId });
                return null;
            }
            return { src, id, date, type, data: item };
        }).filter(Boolean);
        for (const activity of newActivities) {
            if (!onFile[activity.date]) onFile[activity.date] = {};
            onFile[activity.date][activity.id] = activity;
        }
        userSaveFile(username, 'archives/fitness_long', onFile);
        // CLI feedback
        // eslint-disable-next-line no-console
        console.log(`[fitsync] Page offset ${offset}: +${newActivities.length} (total: ${totalFetched})`);

        if (filteredItems.length < items.length) break; // Stop if items are outside the anchor range
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
        fitsyncLogger.info('fitsync.harvest.activities', { jobId: job_id, count: activitiesData.items.length });

        // Incremental summary writing
        let onFile = userLoadFile(username, 'fitness') || {};
        for (const activity of activitiesData.items) {
            const date = moment(activity.date).tz(timezone).format('YYYY-MM-DD');
            if (!onFile[date]) onFile[date] = { steps: {}, activities: [] };
            // Steps summary
            if (activity.activity === 'Steps') {
                onFile[date].steps.steps_count = (onFile[date].steps.steps_count || 0) + (activity.steps || 0);
                onFile[date].steps.bmr = (onFile[date].steps.bmr || 0) + (activity.bmr || 0);
                onFile[date].steps.duration = parseFloat(((onFile[date].steps.duration || 0) + ((activity.duration || 0)/60)).toFixed(2));
                onFile[date].steps.calories = parseFloat(((onFile[date].steps.calories || 0) + (activity.calories || 0)).toFixed(2));
                onFile[date].steps.maxHeartRate = Math.max(onFile[date].steps.maxHeartRate || 0, activity.maxHeartrate || 0);
                onFile[date].steps.avgHeartRate = parseFloat(((onFile[date].steps.avgHeartRate || 0) + (activity.avgHeartrate || 0)).toFixed(2));
            } else {
                // Activities
                onFile[date].activities = onFile[date].activities || [];
                onFile[date].activities.push({
                    title: activity.title || activity.type || '',
                    calories: parseFloat((activity.calories || 0).toFixed(2)),
                    distance: parseFloat((activity.distance || 0).toFixed(2)),
                    minutes: parseFloat((activity.duration/60 || 0).toFixed(2)),
                    startTime: activity.date ? moment(activity.date).tz(timezone).format('hh:mm a') : '',
                    endTime: activity.endDate ? moment(activity.endDate).tz(timezone).format('hh:mm a') : '',
                    avgHeartrate: parseFloat((activity.avgHeartrate || 0).toFixed(2)),
                    steps: activity.steps || 0,
                });
            }
            // Write after each activity (safe for small batches)
            userSaveFile(username, 'fitness', onFile);
            // eslint-disable-next-line no-console
            console.log(`[fitsync] Wrote summary for ${date}`);
        }

        // Success! Reset circuit breaker
        recordSuccess();
        fitsyncLogger.info('fitsync.harvest.complete', { 
            jobId: job_id,
            dates: Object.keys(onFile).length,
            username 
        });
        return onFile;
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