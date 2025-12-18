// Chatbots Root Router
// Responsibility: common middleware (traceId, timing) + mount per-bot subrouters.

import express from 'express';
import crypto from 'crypto';
import nutribotRouter from './nutribot/server.mjs';
// STUBBED: journalist folder removed
// import journalistRouter from './journalist/server.mjs';
import { requestLogger, logger } from './_lib/logging.mjs';

const router = express.Router();

// Trace ID middleware
router.use((req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  next();
});

// Mount bot routers
router.use('/nutribot', nutribotRouter);
// STUBBED: journalist router removed
// router.use('/journalist', journalistRouter);

// Fallback for unknown routes under /chatbots
router.all('*', (req, res) => {
  res.status(404).json({ error: 'Unknown chatbots endpoint', path: req.originalUrl, traceId: req.traceId });
});

export default router;
