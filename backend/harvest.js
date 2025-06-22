import express from 'express';
const harvestRouter = express.Router();
import crypto from 'crypto';

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
import { harvestActivities as fitness } from './lib/fitsync.mjs';
import { harvestActivities as strava } from './lib/strava.mjs';
import { refreshFinancialData as budget, payrollSyncJob } from './lib/budget.mjs';

const harvesters = {
    ...Infinity.keys.reduce((fn, i) => (fn[i] = (req) => Infinity.loadData(i,req), fn), {}),
    todoist,
    gmail,
    gcal,
    withings,
    ldsgc,
    weather,
    scripture,
    clickup,
    lastfm,
    letterboxd,
    goodreads,
    budget,
    youtube_dl,
    fitness,
    strava,
    health,
    payroll: payrollSyncJob
    
}

const harvestKeys = Object.keys(harvesters);

harvestKeys.forEach(key => {
    harvestRouter.get(`/${key}`, async (req, res) =>{
        try {
            const guidId = crypto.randomUUID().split('-').pop();
            const response = await harvesters[key](guidId,req);
            return res.status(200).json(response);
        
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    });
});

//root
harvestRouter.get('/', async (req, res) => {
    return res.status(200).json({availableEndpoints: harvestKeys});
});


//handle all other requests, post or get
harvestRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint.
    You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist.
    The only available endpoints are ${harvestRouter.stack.map(i=>i.route.path).join(', ')}
    `});
});

export default harvestRouter;