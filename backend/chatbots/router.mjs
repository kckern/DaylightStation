// Chatbots Root Router
// Responsibility: common middleware (traceId, timing) + mount per-bot subrouters.

import express from 'express';
import crypto from 'crypto';
import nutribotRouter from './nutribot/server.mjs';
import { requestLogger, logger } from './_lib/logging.mjs';

const router = express.Router();

router.use('/nutribot', nutribotRouter);



// Fallback for unknown routes under /chatbots
router.all('*', (req, res) => {
  res.status(404).json({ error: 'Unknown chatbots endpoint', path: req.originalUrl, traceId: req.traceId });
});

export default router;
