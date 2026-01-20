import express from 'express';
import { turnOnTVPlug } from '../lib/homeassistant.mjs';
import { createLogger } from '../lib/logging/logger.js';
import { getEntropyReport } from '../lib/entropy.mjs';

const apiRouter = express.Router();

const homeLogger = createLogger({
    source: 'backend',
    app: 'home'
});


// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    homeLogger.error('home.middleware.error', { message: err?.message || err, stack: err?.stack });
    res.status(500).json({ error: err.message });
});

apiRouter.get('/entropy', async (req, res) => {
    try {
        const report = await getEntropyReport();
        res.json(report);
    } catch (error) {
        homeLogger.error('home.entropy.error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate entropy report' });
    }
});

apiRouter.get('/calendar',  async (req, res, next) => {
    return res.json({message: 'Hello from the calendar endpoint'});
});

apiRouter.get('/todo',  async (req, res, next) => {
    return res.json({message: 'Hello from the todo endpoint'});
});



export default apiRouter;