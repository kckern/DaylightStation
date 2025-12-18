import express from 'express';
const harvestRouter = express.Router();
import crypto from 'crypto';
import { createLogger } from './lib/logging/logger.js';
import { configService } from './lib/config/ConfigService.mjs';

import todoist from './lib/todoist.js';
import gmail from './lib/gmail.js';
import gcal from './lib/gcal.js';
import withings from './lib/withings.mjs';
import weather from './lib/weather.js';
import clickup from './lib/clickup.js';
import lastfm from './lib/lastfm.js';
import letterboxd from './lib/letterboxd.js';
import goodreads from './lib/goodreads.js';
import Infinity from './lib/infinity.js';
import scripture from './lib/scriptureguide.mjs';
import ldsgc from './lib/ldsgc.mjs';
import youtube_dl from './lib/youtube.mjs';
import health from './lib/health.mjs';
import fitness from './lib/fitsync.mjs';
import strava from './lib/strava.mjs';
import garmin from './lib/garmin.mjs';
import { refreshFinancialData as budget, payrollSyncJob } from './lib/budget.mjs';

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
    budget: (_logger, guidId, req) => budget(guidId, req),
    youtube_dl: (_logger, guidId, req) => youtube_dl(guidId, req),
    fitness: (_logger, guidId, req) => fitness(guidId, req),
    strava: (logger, guidId, req) => strava(logger, guidId, req),
    health: (_logger, guidId, req) => health(guidId, req),
    garmin: (_logger, guidId, req) => garmin(guidId, req),
    payroll: (_logger, guidId, req) => payrollSyncJob(guidId, req)
    
}

const harvestKeys = Object.keys(harvesters);
const baseLogger = harvestRootLogger();

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

harvestKeys.forEach(key => {
    harvestRouter.get(`/${key}`, async (req, res) =>{
        try {
            const guidId = crypto.randomUUID().split('-').pop();
            const username = resolveUsername(req);
            const requestLogger = baseLogger.child({ harvester: key, requestId: guidId, username });
            requestLogger.info('harvest.request', { path: req.originalUrl, method: req.method, username });

            // Attach username to request for harvesters to use
            req.targetUsername = username;

            const invokeHarvester = (fn) => {
                if (fn.length >= 3) return fn(requestLogger, guidId, req);
                if (fn.length === 2) return fn(requestLogger, guidId);
                return fn(guidId, req);
            };

            const response = await invokeHarvester(harvesters[key]);
            requestLogger.info('harvest.response', { type: typeof response, isArray: Array.isArray(response) });
            return res.status(200).json(response);
        
        } catch (error) {
            baseLogger.error('harvest.error', { harvester: key, error: error.message, stack: error.stack });
            return res.status(500).json({error: error.message});
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