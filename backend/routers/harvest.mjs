/**
 * Harvest Router - Data Collection Endpoints
 * 
 * Provides RESTful endpoints for triggering data harvesting from various services.
 * 
 * Features:
 * - ⏱️  Timeout protection (prevents runaway operations)
 * - 🛡️  Error sanitization (removes sensitive tokens from error messages)
 * - 📊  Structured logging with request IDs
 * - 🔄  Circuit breaker integration (respects service cooldowns)
 * - 👤  Multi-user support (via ?user= query param)
 * 
 * Usage:
 *   GET /harvest              - List available harvesters
 *   GET /harvest/<service>    - Trigger specific harvester
 *   GET /harvest/<service>?user=<username> - Override target user
 * 
 * Error Responses:
 *   - 500: Generic harvester error
 *   - 503: Service in cooldown (circuit breaker)
 *   - 504: Timeout exceeded
 *   - 429: Rate limited by external API
 */
import express from 'express';
const harvestRouter = express.Router();
import crypto from 'crypto';
import { createLogger } from '../lib/logging/logger.js';
import { configService } from '../lib/config/ConfigService.mjs';

import todoist from '../lib/todoist.mjs';
import gmail from '../lib/gmail.mjs';
import gcal from '../lib/gcal.mjs';
import withings from '../lib/withings.mjs';
import weather from '../lib/weather.mjs';
import clickup from '../lib/clickup.mjs';
import lastfm from '../lib/lastfm.mjs';
import letterboxd from '../lib/letterboxd.mjs';
import goodreads from '../lib/goodreads.mjs';
import github from '../lib/github.mjs';
import reddit from '../lib/reddit.mjs';
import Infinity from '../lib/infinity.mjs';
import scripture from '../lib/scriptureguide.mjs';
import ldsgc from '../lib/ldsgc.mjs';
import youtube_dl from '../lib/youtube.mjs';
import health from '../lib/health.mjs';
import fitness from '../lib/fitsync.mjs';
import strava from '../lib/strava.mjs';
import garmin from '../lib/garmin.mjs';
import foursquare from '../lib/foursquare.mjs';
import { refreshFinancialData as budget, payrollSyncJob } from '../lib/budget.mjs';

const harvestRootLogger = () => createLogger({
    source: 'backend',
    app: 'harvest',
    context: { env: process.env.NODE_ENV }
});

const harvesters = {
    ...Infinity.keys.reduce((fn, i) => {
        fn[i] = (_logger, _guidId, req) => Infinity.loadData(i, req);
        return fn;
    }, {}),
    todoist: (logger, guidId, req) => todoist(logger, guidId, req),
    gmail: (logger, guidId, req) => gmail(logger, guidId, req),
    gcal: (logger, guidId, req) => gcal(logger, guidId, req),
    withings: (_logger, guidId, req) => withings(guidId, req),
    ldsgc: (_logger, guidId, req) => ldsgc(guidId, req),
    weather: (_logger, guidId, req) => weather(guidId, req),
    scripture: (_logger, guidId, req) => scripture(guidId, req),
    clickup: (_logger, guidId, req) => clickup(guidId, req),
    lastfm: (_logger, guidId, req) => lastfm(guidId, req),
    letterboxd: (_logger, guidId, req) => letterboxd(guidId, req),
    goodreads: (_logger, guidId, req) => goodreads(guidId, req),
    github: (_logger, guidId, req) => github(guidId, req),
    reddit: (_logger, guidId, req) => reddit(guidId, req),
    budget: (_logger, guidId, req) => budget(guidId, req),
    youtube_dl: (_logger, guidId, req) => youtube_dl(guidId, req),
    fitness: (_logger, guidId, req) => fitness(guidId, req),
    strava: (logger, guidId, req) => strava(logger, guidId, req),
    health: (_logger, guidId, req) => health(guidId, req),
    garmin: (_logger, guidId, req) => garmin(guidId, req),
    foursquare: (_logger, guidId, req) => foursquare(guidId, req),
    payroll: (_logger, guidId, req) => payrollSyncJob(guidId, req)
    
}

const harvestKeys = Object.keys(harvesters);
const baseLogger = harvestRootLogger();

// Timeout configuration (ms)
const HARVEST_TIMEOUT = 120000; // 2 minutes default
const HARVEST_TIMEOUTS = {
    fitness: 180000,    // 3 minutes for fitness sync
    strava: 180000,     // 3 minutes for strava
    garmin: 180000,     // 3 minutes for garmin
    health: 180000,     // 3 minutes for health data aggregation
    budget: 240000,     // 4 minutes for budget compilation
    gmail: 180000,      // 3 minutes for gmail
    gcal: 120000,       // 2 minutes for calendar
    withings: 120000,   // 2 minutes for withings
};

/**
 * Resolve the target username from request query param or default to head of household
 * @param {Request} req - Express request object
 * @returns {string|null} The resolved username
 */
const resolveUsername = (req) => {
    // Check for explicit ?user= query parameter
    if (req.query.user) {
        return req.query.user;
    }
    // Default to head of household
    return configService.getHeadOfHousehold();
};

/**
 * Wrap a promise with a timeout to prevent runaway operations
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} harvesterName - Name of the harvester for error messages
 * @returns {Promise} Promise that rejects on timeout
 */
const withTimeout = (promise, timeoutMs, harvesterName) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout: ${harvesterName} exceeded ${timeoutMs}ms limit`)), timeoutMs)
        )
    ]);
};

/**
 * Sanitize error for API response (avoid leaking sensitive info)
 * @param {Error} error - The error to sanitize
 * @param {string} harvesterName - Name of the harvester
 * @returns {Object} Sanitized error object
 */
const sanitizeError = (error, harvesterName) => {
    const sanitized = {
        harvester: harvesterName,
        message: error.message || 'Unknown error',
        type: error.name || 'Error'
    };
    
    // Include status code if available
    if (error.response?.status) {
        sanitized.statusCode = error.response.status;
    }
    
    // Include rate limit info if present
    if (error.message?.includes('cooldown') || error.message?.includes('rate limit')) {
        sanitized.rateLimited = true;
    }
    
    // Strip sensitive data from error messages
    sanitized.message = sanitized.message
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
        .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
        .replace(/key[=:]\s*[^\s&]+/gi, 'key=[REDACTED]')
        .replace(/secret[=:]\s*[^\s&]+/gi, 'secret=[REDACTED]')
        .replace(/password[=:]\s*[^\s&]+/gi, 'password=[REDACTED]');
    
    return sanitized;
};

harvestKeys.forEach(key => {
    harvestRouter.get(`/${key}`, async (req, res) =>{
        const guidId = crypto.randomUUID().split('-').pop();
        const username = resolveUsername(req);
        const requestLogger = baseLogger.child({ harvester: key, requestId: guidId, username });
        
        try {
            requestLogger.info('harvest.request', { path: req.originalUrl, method: req.method, username });

            // Attach username to request for harvesters to use
            req.targetUsername = username;

            const invokeHarvester = (fn) => {
                if (fn.length >= 3) return fn(requestLogger, guidId, req);
                if (fn.length === 2) return fn(requestLogger, guidId);
                return fn(guidId, req);
            };

            // Apply timeout protection
            const timeoutMs = HARVEST_TIMEOUTS[key] || HARVEST_TIMEOUT;
            const harvesterPromise = invokeHarvester(harvesters[key]);
            const response = await withTimeout(harvesterPromise, timeoutMs, key);
            
            // Validate response before sending
            if (response === undefined || response === null) {
                requestLogger.warn('harvest.empty_response', { harvester: key });
                return res.status(200).json({ data: [], message: `No data returned from ${key}` });
            }
            
            requestLogger.info('harvest.response', { 
                type: typeof response, 
                isArray: Array.isArray(response),
                itemCount: Array.isArray(response) ? response.length : undefined
            });
            return res.status(200).json(response);
        
        } catch (error) {
            // Log full error details internally
            requestLogger.error('harvest.error', { 
                harvester: key, 
                error: error.message, 
                stack: error.stack,
                statusCode: error.response?.status,
                isTimeout: error.message?.includes('Timeout')
            });
            
            // Return sanitized error to client
            const sanitized = sanitizeError(error, key);
            const statusCode = error.response?.status === 429 ? 429 : 
                              error.message?.includes('Timeout') ? 504 :
                              error.message?.includes('cooldown') ? 503 : 500;
            
            return res.status(statusCode).json({ 
                error: sanitized.message,
                harvester: sanitized.harvester,
                type: sanitized.type,
                rateLimited: sanitized.rateLimited,
                requestId: guidId
            });
        }
    });
});

//root
harvestRouter.get('/', async (req, res) => {
    const username = resolveUsername(req);
    return res.status(200).json({
        availableEndpoints: harvestKeys,
        defaultUser: username,
        usage: 'Add ?user=username to specify target user (defaults to head of household)'
    });
});


//handle all other requests, post or get
harvestRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint.
    You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist.
    The only available endpoints are ${harvestRouter.stack.map(i=>i.route.path).join(', ')}
    `});
});

export default harvestRouter;