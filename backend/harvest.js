import express from 'express';
const harvestRouter = express.Router();

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
import { refreshFinancialData as budget } from './lib/budget.mjs';

const harvesters = {
    ...Infinity.keys.reduce((fn, i) => (fn[i] = () => Infinity.loadData(i), fn), {}),
    todoist,
    gmail,
    gcal,
    withings,
    weather,
    scripture,
    clickup,
    lastfm,
    letterboxd,
    goodreads,
    budget
    
}

const harvestKeys = Object.keys(harvesters);

harvestKeys.forEach(key => {
    harvestRouter.get(`/${key}`, async (req, res) =>{
        try {
            const response = await harvesters[key](req);
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