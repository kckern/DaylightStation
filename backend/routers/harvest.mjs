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
import shopping from '../lib/shopping.mjs';
import { refreshFinancialData as budget, payrollSyncJob } from '../lib/budget.mjs';
import ArchiveService from '../lib/ArchiveService.mjs';
import archiveRotation from '../lib/archiveRotation.mjs';

const harvestRootLogger = () => createLogger({
    source: 'backend',
    app: 'harvest',
    context: { env: process.env.NODE_ENV }
});

const harvesters = {
    ...Infinity.keys.reduce((fn, i) => {
        fn[i] = (_logger, _guidId, username) => Infinity.loadData(i, { targetUsername: username });
        return fn;
    }, {}),
    todoist: (logger, guidId, username) => todoist(logger, guidId, username),
    gmail: (logger, guidId, username) => gmail(logger, guidId, username),
    gcal: (logger, guidId, username) => gcal(logger, guidId, username),
    withings: (_logger, guidId, username) => withings(guidId, { targetUsername: username }),
    ldsgc: (_logger, guidId, username) => ldsgc(guidId, { targetUsername: username }),
    weather: (_logger, guidId, username) => weather(guidId, { targetUsername: username }),
    scripture: (_logger, guidId, username) => scripture(guidId, { targetUsername: username }),
    clickup: (_logger, guidId, username) => clickup(guidId, { targetUsername: username }),
    lastfm: (_logger, guidId, username) => lastfm(guidId, { targetUsername: username }),
    letterboxd: (_logger, guidId, username) => letterboxd(username),
    goodreads: (_logger, guidId, username) => goodreads(username),
    github: (_logger, guidId, username) => github(guidId, { targetUsername: username }),
    reddit: (_logger, guidId, username) => reddit(guidId, { targetUsername: username }),
    budget: (_logger, guidId, username) => budget(guidId, { targetUsername: username }),
    youtube_dl: (_logger, guidId, username) => youtube_dl(guidId, { targetUsername: username }),
    fitness: (_logger, guidId, username) => fitness(guidId, { targetUsername: username }),
    strava: (logger, guidId, username) => strava(logger, guidId, username),
    health: (_logger, guidId, username) => health(guidId, { targetUsername: username }),
    garmin: (_logger, guidId, username) => garmin(guidId, { targetUsername: username }),
    foursquare: (_logger, guidId, username) => foursquare(guidId, { targetUsername: username }),
    payroll: (_logger, guidId, username) => payrollSyncJob(guidId, { targetUsername: username }),
    shopping: (logger, guidId, username) => shopping(logger, guidId, username)
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
    shopping: 300000,   // 5 minutes for shopping (AI extraction)
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
                if (fn.length >= 3) return fn(requestLogger, guidId, username); // Pass username string, not req object
                if (fn.length === 2) return fn(requestLogger, guidId);
                if (fn.length === 1) return fn(username); // Single-param harvesters (goodreads, letterboxd) get username
                return fn(guidId, req); // Legacy harvesters with no params
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
        usage: 'Add ?user=username to specify target user (defaults to head of household)',
        archiveEndpoints: ['/archive/status', '/archive/rotate', '/archive/migrate']
    });
});

// ============================================================
// ARCHIVE MANAGEMENT ENDPOINTS
// ============================================================

/**
 * GET /harvest/archive/status
 * Get archive status for all configured services
 */
harvestRouter.get('/archive/status', async (req, res) => {
    const username = resolveUsername(req);
    const service = req.query.service;
    
    try {
        const archiveConfig = configService.getAppConfig('archive');
        if (!archiveConfig?.services) {
            return res.status(200).json({ message: 'No archive configuration found' });
        }
        
        const services = service 
            ? { [service]: archiveConfig.services[service] }
            : archiveConfig.services;
        
        const status = {};
        for (const [svc, config] of Object.entries(services)) {
            if (config?.enabled) {
                status[svc] = ArchiveService.getArchiveStatus(username, svc);
            }
        }
        
        return res.status(200).json({ username, status });
    } catch (error) {
        baseLogger.error('harvest.archive.status.error', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /harvest/archive/rotate
 * Manually trigger archive rotation for all services
 */
harvestRouter.post('/archive/rotate', async (req, res) => {
    const guidId = crypto.randomUUID().split('-').pop();
    
    try {
        const result = await archiveRotation(guidId);
        return res.status(200).json(result);
    } catch (error) {
        baseLogger.error('harvest.archive.rotate.error', { error: error.message, guidId });
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /harvest/archive/migrate
 * Migrate a service to hot/cold storage (dry-run by default)
 * Query params:
 *   - service: Service name (required)
 *   - execute: 'true' to actually perform migration (default: dry-run)
 */
harvestRouter.post('/archive/migrate', async (req, res) => {
    const username = resolveUsername(req);
    const service = req.query.service;
    const execute = req.query.execute === 'true';
    
    if (!service) {
        return res.status(400).json({ error: 'Missing required query param: service' });
    }
    
    try {
        const result = ArchiveService.migrateToHotCold(username, service, { dryRun: !execute });
        return res.status(200).json(result);
    } catch (error) {
        baseLogger.error('harvest.archive.migrate.error', { service, error: error.message });
        return res.status(500).json({ error: error.message });
    }
});


//handle all other requests, post or get
harvestRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint.
    You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist.
    The only available endpoints are ${harvestRouter.stack.map(i=>i.route.path).join(', ')}
    `});
});

export default harvestRouter;