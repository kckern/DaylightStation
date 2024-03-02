import express from 'express';
const harvestRouter = express.Router();

import todoist from './lib/todoist.js';

harvestRouter.get('/todoist',todoist);

harvestRouter.get('*',  async (req, res) => {
    return res.status(404).json({error: 'Invalid endpoint'});
});

//handle all other requests, post or get
harvestRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: 'Invalid endpoint'});
});

export default harvestRouter;