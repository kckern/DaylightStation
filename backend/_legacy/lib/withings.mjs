import moment from 'moment';
import axios from './http.mjs';
import { saveFile, loadFile, userSaveAuth, userSaveFile } from './io.mjs';
import { configService } from './config/index.mjs';
import processWeight from '../jobs/weight.mjs';
import { createLogger } from './logging/logger.js';

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();

const withingsLogger = createLogger({ source: 'backend', app: 'withings' });

// Circuit breaker state for rate limiting resilience
const circuitBreaker = {
  failures: 0,
  cooldownUntil: null,
  maxFailures: 3,
  baseCooldownMs: 5 * 60 * 1000, // 5 minutes
  maxCooldownMs: 2 * 60 * 60 * 1000, // 2 hours max
};

const tokenBufferSeconds = 60; // refresh 1 minute before expiry
const accessTokenCache = {
    token: null,
    expiresAt: null
};

const resolveSecrets = () => {
    // Support legacy and new names
    const clientId = process.env.WITHINGS_CLIENT_ID || configService.getSecret('WITHINGS_CLIENT_ID') || process.env.WITHINGS_CLIENT || configService.getSecret('WITHINGS_CLIENT');
    const clientSecret = process.env.WITHINGS_CLIENT_SECRET || configService.getSecret('WITHINGS_CLIENT_SECRET') || process.env.WITHINGS_SECRET || configService.getSecret('WITHINGS_SECRET');
    const redirectUri = process.env.WITHINGS_REDIRECT || configService.getSecret('WITHINGS_REDIRECT');
    return { clientId, clientSecret, redirectUri };
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

/**
 * Check if circuit breaker is open (in cooldown)
 * @returns {boolean|Object} false if OK to proceed, or cooldown info object
 */
const isInCooldown = () => {
  if (!circuitBreaker.cooldownUntil) return false;
  if (Date.now() >= circuitBreaker.cooldownUntil) {
    circuitBreaker.cooldownUntil = null;
    circuitBreaker.failures = 0;
    withingsLogger.info('withings.circuit.reset', { message: 'Cooldown expired, circuit reset' });
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
    withingsLogger.warn('withings.circuit.open', {
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
    withingsLogger.info('withings.circuit.success', { previousFailures: circuitBreaker.failures });
  }
  circuitBreaker.failures = 0;
  circuitBreaker.cooldownUntil = null;
};

const getAccessToken = async (username, authData) => {
    const now = moment();
    const isCachedValid = () => accessTokenCache.token && accessTokenCache.expiresAt && now.isBefore(accessTokenCache.expiresAt);

    if (isCachedValid()) {
        withingsLogger.debug('withings.auth.cache_hit', { expiresAt: accessTokenCache.expiresAt.toISOString() });
        return accessTokenCache.token;
    }

    if (process.env.WITHINGS_ACCESS_TOKEN && process.env.WITHINGS_ACCESS_TOKEN_EXPIRES_AT) {
        const envExpiry = moment(process.env.WITHINGS_ACCESS_TOKEN_EXPIRES_AT);
        if (envExpiry.isValid() && envExpiry.isAfter(now)) {
            accessTokenCache.token = process.env.WITHINGS_ACCESS_TOKEN;
            accessTokenCache.expiresAt = envExpiry;
            withingsLogger.debug('withings.auth.env_token_reused', { expiresAt: envExpiry.toISOString() });
            return accessTokenCache.token;
        }
    }

    const { clientId, clientSecret, redirectUri } = resolveSecrets();
    const refresh = authData?.refresh_token || authData?.refresh;
    // Allow seeded access token with expiry from auth file for immediate reuse
    // IMPORTANT: Only use expires_at (absolute timestamp), not expires_in (relative seconds)
    if (!accessTokenCache.token && authData?.access_token) {
        const expiresAt = authData?.expires_at ? moment(authData.expires_at) : null;
        if (expiresAt && expiresAt.isValid() && expiresAt.isAfter(now.clone().add(tokenBufferSeconds, 'seconds'))) {
            accessTokenCache.token = authData.access_token;
            accessTokenCache.expiresAt = expiresAt;
            process.env.WITHINGS_ACCESS_TOKEN = authData.access_token;
            process.env.WITHINGS_ACCESS_TOKEN_EXPIRES_AT = expiresAt.toISOString();
            withingsLogger.debug('withings.auth.seed_token_loaded', { expiresAt: expiresAt.toISOString() });
            return accessTokenCache.token;
        }
        // No valid seeded token - will fall through to refresh
        withingsLogger.debug('withings.auth.seed_token_expired', { 
            expiresAt: expiresAt?.toISOString() || 'missing',
            hasRefreshToken: !!refresh
        });
    }

    if (!clientId || !clientSecret) {
        withingsLogger.error('withings.auth.credentials_missing', { message: 'WITHINGS_CLIENT_ID/SECRET missing' });
        return null;
    }
    if (!refresh) {
        withingsLogger.error('withings.auth.missing_refresh', { message: 'No refresh token found', username });
        return null;
    }

    const params_auth = {
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        redirect_uri: redirectUri
    };

    try {
        const response = await axios.post('https://wbsapi.withings.net/v2/oauth2', params_auth);
        const auth_data = response?.data?.body || {};
        const access_token = auth_data.access_token;
        const refresh_token = auth_data.refresh_token;
        const expiresIn = auth_data.expires_in || 3600;
        const expiresAt = moment().add(Math.max(60, expiresIn - tokenBufferSeconds), 'seconds');

        // Save full auth response for persistence across restarts
        // Use expires_at (absolute timestamp) instead of expires_in (relative seconds)
        const updatedAuth = {
            ...authData,
            access_token,
            expires_at: expiresAt.toISOString(),
            refresh_token: refresh_token || refresh, // Keep old refresh if not provided
            updated_at: new Date().toISOString()
        };
        // Remove legacy fields
        delete updatedAuth.refresh;
        delete updatedAuth.expires_in;
        
        if (refresh_token) {
            userSaveAuth(username, 'withings', updatedAuth);
        } else if (access_token) {
            // Even without new refresh token, save the access token
            userSaveAuth(username, 'withings', updatedAuth);
        }

        if (!access_token) {
            withingsLogger.error('withings.auth.no_access_token', { response: response?.data });
            return null;
        }

        accessTokenCache.token = access_token;
        accessTokenCache.expiresAt = expiresAt;
        process.env.WITHINGS_ACCESS_TOKEN = access_token;
        process.env.WITHINGS_ACCESS_TOKEN_EXPIRES_AT = expiresAt.toISOString();
        withingsLogger.info('withings.auth.token_refreshed', { username, expiresAt: expiresAt.toISOString() });
        return access_token;
    } catch (error) {
        const statusCode = error.response?.status;
        const isAuthError = statusCode === 401 || statusCode === 403;
        
        withingsLogger.error('withings.auth.refresh_failed', {
            error: cleanErrorMessage(error),
            statusCode,
            code: error.code,
            username,
            isAuthExpired: isAuthError
        });
        
        // Alert if refresh token has expired (needs re-authorization)
        if (isAuthError) {
            withingsLogger.error('withings.auth.expired', {
                message: 'Refresh token expired or invalid - re-authorization required',
                username,
                statusCode
            });
        }
        
        accessTokenCache.token = null;
        accessTokenCache.expiresAt = null;
        delete process.env.WITHINGS_ACCESS_TOKEN;
        delete process.env.WITHINGS_ACCESS_TOKEN_EXPIRES_AT;
        return null;
    }
};

const getWeightData = async (job_id) => {

    //In Dev, the api is not called, and previous api data is sent to the processWeight function
    if(!!process.env.dev) return processWeight(job_id);

    // Check circuit breaker before attempting harvest
    const cooldownStatus = isInCooldown();
    if (cooldownStatus) {
        withingsLogger.debug('withings.harvest.skipped', {
            reason: 'Circuit breaker active',
            remainingMins: cooldownStatus.remainingMins
        });
        return { skipped: true, reason: 'cooldown', remainingMins: cooldownStatus.remainingMins };
    }

    const { clientId, clientSecret, redirectUri } = resolveSecrets();
    const username = getDefaultUsername();
    // Load auth fresh from disk (not cached ConfigService) to get latest tokens
    const authData = loadFile(`users/${username}/auth/withings`) || {};
    const { refresh } = authData;
    
    try {
        const access_token = await getAccessToken(username, authData);

        if (!access_token) {
            withingsLogger.warn('withings.harvest.no_token', {
                username,
                message: 'No access token available - refresh token may have expired',
                action: 'Using cached data',
                reAuthUrl: 'https://account.withings.com/oauth2_user/authorize2'
            });
            processWeight(job_id);
            return { error: 'No access token. Refresh token may have expired. Re-authorization required.' };
        }

    const params = {
        access_token,
        startdate: Math.floor(new Date().setFullYear(new Date().getFullYear() - 15) / 1000),
        enddate: Math.floor(new Date().setDate(new Date().getDate() + 1) / 1000)
    };


    const url = 'https://wbsapi.withings.net/measure?action=getmeas';
    const getme = `${url}&${new URLSearchParams(params).toString()}`;

    let data = await axios.get(getme);
    data = data.data;

    let measurements = {};

    // Check if the response has the expected structure
    if (!data || !data.body || !data.body.measuregrps) {
        const errorDetails = {
            status: data?.status,
            error: data?.error,
            message: data?.message,
            response: JSON.stringify(data, null, 2).substring(0, 500)
        };
        withingsLogger.error('withings.api.invalid_response', errorDetails);
        
        // Check for auth errors in the response
        if (data?.status === 401 || data?.error?.includes('invalid_token')) {
            throw new Error(`Withings API authentication failed (${data.status}): ${data.error || 'Invalid or expired token'}`);
        }
        
        throw new Error(`Invalid Withings API response: ${data?.status} - ${data?.error || 'No measuregrps data'}`);
    }

    data['body']['measuregrps'].forEach(measure => {
        const date = new Date(measure['date'] * 1000).toISOString().split('T')[0];
        const time = measure['date'];
        measurements[time] = { time, date };

        measure['measures'].forEach(measure => {
            let type = measure['type'];
            let val = round(measure['value'] * Math.pow(10, measure['unit']), 1);
            if(type === 1) { type = 'lbs'; val = round(2.20462 * val, 1); }
            if(type === 5) { type = 'lean_lbs'; val = round(2.20462 * val, 1); }
            if(type === 8) { type = 'fat_lbs'; val = round(2.20462 * val, 1); }
            if(type === 6) { type = 'fat_percent'; val = round(val, 1); }
            measurements[time][type] = val;
        });
    });

    measurements = Object.values(measurements).sort((a, b) => b.time - a.time);
    measurements = measurements.filter(m => m['lbs']);

    if(measurements.length === 0) return;

    // Save to user-namespaced location
    userSaveFile(username, 'withings', measurements);
    processWeight(job_id);
    
    // Success! Reset circuit breaker
    recordSuccess();
    return measurements;
    
    } catch (error) {
        // Check if it's a rate limit error
        const isRateLimit = error.response?.status === 429 || 
                          error.message?.includes('429') || 
                          error.message?.includes('Too Many Requests') ||
                          error.message?.includes('rate limit');
        
        // Check if it's a network timeout
        const isTimeout = error.code === 'ETIMEDOUT' ||
                         error.code === 'ECONNABORTED' ||
                         error.code === 'ECONNRESET' ||
                         error.message?.includes('timeout');
        
        if (isRateLimit) {
            recordFailure(error);
            withingsLogger.warn('withings.rate_limit', {
                message: 'Rate limit exceeded',
                statusCode: error.response?.status
            });
        } else if (isTimeout) {
            withingsLogger.warn('withings.timeout', {
                error: cleanErrorMessage(error),
                code: error.code,
                message: 'Request timed out - Withings API may be slow or unreachable'
            });
        } else {
            withingsLogger.error('withings.fetch.error', {
                error: cleanErrorMessage(error),
                statusCode: error.response?.status,
                code: error.code
            });
        }
        
        // Still run processWeight with cached data if available
        processWeight(job_id);
        throw error;
    }
};

export { isInCooldown as isWithingsInCooldown };
export default getWeightData;

function round(value, decimals) {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
}