import express from 'express';
import { saveFile } from './lib/io.mjs';
import moment from 'moment-timezone';

const fitnessRouter = express.Router();

// Fitness config endpoint
fitnessRouter.get('/', (req, res) => {
    const fitnessData = process.env.fitness;
    if(!fitnessData) return res.status(404).json({ error: 'Fitness configuration not found' });
    res.json(fitnessData);
});


fitnessRouter.post('/save_session', (req, res) => {
    const { sessionData } = req.body;
    if(!sessionData) return res.status(400).json({ error: 'Session data is required' });
    const sessionDate = sessionData.date || moment().tz("America/Los_Angeles").format('YYYY-MM-DD');
    const sessionDateTime = sessionData.time || moment().tz("America/Los_Angeles").format('YYYY-MM-DD HH.mm.ss');
    const filename = `fitness/sessions/${sessionDate}/${sessionDateTime}`;
    saveFile(filename, sessionData);
    //trigger printer (TODO)

    res.json({ message: 'Session data saved successfully', filename, sessionData });
});


export default fitnessRouter;
