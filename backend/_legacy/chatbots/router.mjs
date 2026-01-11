// Chatbots Root Router
// Responsibility: common middleware (traceId, timing) + mount per-bot subrouters.
// NOTE: Currently NOT used - bots are wired up directly in api.mjs.
// This file exists for potential future refactoring.

import express from 'express';
import crypto from 'crypto';
// import nutribotRouter from './bots/nutribot/server.mjs';
// import homebotRouter from './bots/homebot/server.mjs';
// import journalistRouter from './bots/journalist/server.mjs';
import { requestLogger, logger } from './_lib/logging.mjs';

const router = express.Router();

// Trace ID middleware
router.use((req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  res.setHeader('X-Trace-Id', req.traceId);
  next();
});

// Mount bot routers (currently commented out - wired in api.mjs)
// router.use('/nutribot', nutribotRouter);
// router.use('/homebot', homebotRouter);
// router.use('/journalist', journalistRouter);

// Fallback for unknown routes under /chatbots
router.all('*', (req, res) => {
  res.status(404).json({ error: 'Unknown chatbots endpoint', path: req.originalUrl, traceId: req.traceId });
});

export default router;
