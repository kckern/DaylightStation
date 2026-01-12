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
import { configService } from '../lib/config/index.mjs';
import { userLoadFile, userSaveFile, userSaveAuth } from '../lib/io.mjs';

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
// import ldsgc from '../lib/ldsgc.mjs';
import youtube_dl from '../lib/youtube.mjs';
import health from '../lib/health.mjs';
import fitness from '../lib/fitsync.mjs';
// strava: Now using StravaHarvester from src/2_adapters/harvester/
import foursquare from '../lib/foursquare.mjs';
import shopping from '../lib/shopping.mjs';
import { refreshFinancialData as budget, payrollSyncJob } from '../lib/budget.mjs';
import ArchiveService from '../lib/ArchiveService.mjs';
import archiveRotation from '../lib/archiveRotation.mjs';

// New DDD Harvesters (Phase 3f migration)
import {
    GarminHarvester, StravaHarvester, WithingsHarvester,
    TodoistHarvester, ClickUpHarvester, GitHubHarvester,
    LastfmHarvester, RedditHarvester, LetterboxdHarvester, GoodreadsHarvester,
    YamlLifelogStore, YamlAuthStore
} from '../../src/2_adapters/harvester/index.mjs';
import garminLib from 'garmin-connect';
const { GarminConnect } = garminLib;
import axios from './http.mjs';
import { TodoistApi } from '@doist/todoist-api-typescript';
import Parser from 'rss-parser';

// Create shared lifelog store
const lifelogStore = new YamlLifelogStore({
    io: { userLoadFile, userSaveFile },
    logger: createLogger({ source: 'backend', app: 'lifelogStore' }),
});

// Factory function for Garmin client
const createGarminClient = (username) => {
    const auth = configService.getUserAuth('garmin', username) || {};
    const garminUser = auth.username || configService.getSecret('GARMIN_USERNAME');
    const garminPass = auth.password || configService.getSecret('GARMIN_PASSWORD');

    if (!garminUser || !garminPass) {
        throw new Error(`Garmin credentials not found for user: ${username}`);
    }

    return new GarminConnect({ username: garminUser, password: garminPass });
};

// Create shared auth store
const authStore = new YamlAuthStore({
    io: { userSaveAuth },
    logger: createLogger({ source: 'backend', app: 'authStore' }),
});

// Instantiate new harvesters
const garminHarvester = new GarminHarvester({
    garminClientFactory: createGarminClient,
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'garmin' }),
});

// Strava client wrapper
const stravaClient = {
    accessToken: null,

    async refreshToken(refreshToken) {
        const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
        const response = await axios.post('https://www.strava.com/oauth/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        this.accessToken = response.data.access_token;
        return response.data;
    },

    async getActivities({ before, after, page, perPage }) {
        const url = `https://www.strava.com/api/v3/athlete/activities?before=${before}&after=${after}&page=${page}&per_page=${perPage}`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${this.accessToken}` }
        });
        return response.data;
    },

    async getActivityStreams(activityId, keys) {
        const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys.join(',')}&key_by_type=true`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${this.accessToken}` }
        });
        return response.data;
    }
};

const stravaHarvester = new StravaHarvester({
    stravaClient,
    lifelogStore,
    authStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'strava' }),
});

const withingsHarvester = new WithingsHarvester({
    httpClient: axios,
    lifelogStore,
    authStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'withings' }),
});

// Wave 2: Productivity Harvesters
const todoistHarvester = new TodoistHarvester({
    todoistApi: null, // Will be created per-request with user token
    httpClient: axios,
    lifelogStore,
    currentStore: {
        load: (username) => userLoadFile(username, 'todoist/current.yml'),
        save: (username, data) => userSaveFile(username, 'todoist/current.yml', data),
    },
    configService,
    logger: createLogger({ source: 'backend', app: 'todoist' }),
});

const clickupHarvester = new ClickUpHarvester({
    httpClient: axios,
    lifelogStore,
    currentStore: {
        load: (username) => userLoadFile(username, 'clickup/current.yml'),
        save: (username, data) => userSaveFile(username, 'clickup/current.yml', data),
    },
    configService,
    logger: createLogger({ source: 'backend', app: 'clickup' }),
});

const githubHarvester = new GitHubHarvester({
    httpClient: axios,
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'github' }),
});

// Wave 3: Social Harvesters
const lastfmHarvester = new LastfmHarvester({
    httpClient: axios,
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'lastfm' }),
});

const redditHarvester = new RedditHarvester({
    httpClient: axios,
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'reddit' }),
});

const letterboxdHarvester = new LetterboxdHarvester({
    httpClient: axios,
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'letterboxd' }),
});

const goodreadsHarvester = new GoodreadsHarvester({
    rssParser: new Parser(),
    lifelogStore,
    configService,
    logger: createLogger({ source: 'backend', app: 'goodreads' }),
});

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
    // todoist: Uses new DDD harvester (Phase 3f Wave 2)
    todoist: (_logger, _guidId, username) => todoistHarvester.harvest(username),
    gmail: (logger, guidId, username) => gmail(logger, guidId, username),
    gcal: (logger, guidId, username) => gcal(logger, guidId, username),
    // withings: Uses new DDD harvester (Phase 3f Wave 1)
    withings: (_logger, _guidId, username) => withingsHarvester.harvest(username),
    // ldsgc: (_logger, guidId, username) => ldsgc(guidId, { targetUsername: username }),
    weather: (_logger, guidId, username) => weather(guidId, { targetUsername: username }),
    scripture: (_logger, guidId, username) => scripture(guidId, { targetUsername: username }),
    // clickup: Uses new DDD harvester (Phase 3f Wave 2)
    clickup: (_logger, _guidId, username) => clickupHarvester.harvest(username),
    // lastfm: Uses new DDD harvester (Phase 3f Wave 3)
    lastfm: (_logger, _guidId, username) => lastfmHarvester.harvest(username),
    // letterboxd: Uses new DDD harvester (Phase 3f Wave 3)
    letterboxd: (_logger, _guidId, username) => letterboxdHarvester.harvest(username),
    // goodreads: Uses new DDD harvester (Phase 3f Wave 3)
    goodreads: (_logger, _guidId, username) => goodreadsHarvester.harvest(username),
    // github: Uses new DDD harvester (Phase 3f Wave 2)
    github: (_logger, _guidId, username) => githubHarvester.harvest(username),
    // reddit: Uses new DDD harvester (Phase 3f Wave 3)
    reddit: (_logger, _guidId, username) => redditHarvester.harvest(username),
    budget: (_logger, guidId, username) => budget(guidId, { targetUsername: username }),
    youtube_dl: (_logger, guidId, username) => youtube_dl(guidId, { targetUsername: username }),
    fitness: (_logger, guidId, username) => fitness(guidId, { targetUsername: username }),
    // strava: Uses new DDD harvester (Phase 3f)
    strava: (_logger, _guidId, username) => stravaHarvester.harvest(username),
    health: (_logger, guidId, username) => health(guidId, { targetUsername: username }),
    // garmin: Uses new DDD harvester (Phase 3f)
    garmin: (_logger, _guidId, username) => garminHarvester.harvest(username),
    foursquare: (_logger, guidId, username) => foursquare(guidId, { targetUsername: username }),
    payroll: (...args) => payrollSyncJob(...args),
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