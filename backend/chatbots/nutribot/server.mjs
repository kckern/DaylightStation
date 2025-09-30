// Nutriboat Server Router
// Exports an Express router mounted at /chatbots/nutribot (see parent router)
// Endpoints:
//   POST /webhook     -> inbound platform events
//   GET  /report      -> JSON nutrition report summary
//   GET  /report/img  -> Image representation of report
//   GET  /coach       -> Coaching tip / recommendation

import express from 'express';
import { requestLogger, wrapAsync } from '../_lib/logging.mjs';

// Handlers
import webhookHandler from './handlers/webhook.mjs';
import reportHandler from './handlers/report.mjs';
import reportImgHandler from './handlers/reportImg.mjs';
import coachHandler from './handlers/coach.mjs';

const router = express.Router();

// Common middleware: attach logging context
router.use(requestLogger('nutribot'));
router.use(express.json({ strict: false }));

// Health / root
router.get('/', (req, res) => {
	res.json({ ok: true, bot: 'nutribot', endpoints: ['/webhook (POST)', '/report', '/report/img', '/coach'], traceId: req.traceId });
});

// Routes
router.post('/webhook', wrapAsync(webhookHandler));
router.get('/report', wrapAsync(reportHandler));
router.get('/report/img', wrapAsync(reportImgHandler));
router.get('/coach', wrapAsync(coachHandler));

// 404 inside nutribot scope
router.all('*', (req, res) => {
	res.status(404).json({ error: 'nutribot endpoint not found', path: req.originalUrl, traceId: req.traceId });
});

export default router;

