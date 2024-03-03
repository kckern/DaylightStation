import express from 'express';
const harvestRouter = express.Router();

import todoist from './lib/todoist.js';
import gmail from './lib/gmail.js';
import gcal from './lib/gcal.js';
import withings from './lib/withings.js';
import buxfer from './lib/buxfer.js';
import weather from './lib/weather.js';
import clickup from './lib/clickup.js';
import lastfm from './lib/lastfm.js';

const harvesters = {
    todoist,
    gmail,
    gcal,
    withings,
    buxfer,
    weather,
    clickup,
    lastfm
    
}

Object.keys(harvesters).forEach(key => {
    harvestRouter.get(`/${key}`, async (req, res) =>{
        try {
            const response = await harvesters[key](req);
            return res.status(200).json(response);
        
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
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