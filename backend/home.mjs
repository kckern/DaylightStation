import express from 'express';
import { turnOnTVPlug } from './lib/homeassistant.mjs';
import { createLogger, logglyTransportAdapter } from './lib/logging/index.js';
const apiRouter = express.Router();

const homeLogger = createLogger({
    name: 'backend-home',
    context: { app: 'backend', module: 'home' },
    level: process.env.HOME_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
    transports: [logglyTransportAdapter({ tags: ['backend', 'home'] })]
});


// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    homeLogger.error('home.middleware.error', { message: err?.message || err, stack: err?.stack });
    res.status(500).json({ error: err.message });
});

apiRouter.get('/calendar',  async (req, res, next) => {
    return res.json({message: 'Hello from the calendar endpoint'});
});

apiRouter.get('/todo',  async (req, res, next) => {
    return res.json({message: 'Hello from the todo endpoint'});
});



export default apiRouter;