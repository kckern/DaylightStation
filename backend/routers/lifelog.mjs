import express from 'express';
import { createLogger } from '../lib/logging/logger.js';

const lifelogLogger = createLogger({ source: 'backend', app: 'lifelog' });
const lifelogRouter = express.Router();

// Hello world endpoint
lifelogRouter.get('/', (req, res) => {
    lifelogLogger.debug('lifelog.hello.request');
    res.json({
        message: 'Hello World from Lifelog API',
        status: 'success'
    });
});

export default lifelogRouter;
