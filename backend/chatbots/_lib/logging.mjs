// Central logging module for chatbots subsystem
// Usage guidelines:
//  - Do not use console.log directly elsewhere in /backend/chatbots
//  - Import { logger } or create a child logger via createLogger({ bot: 'nutribot' })
//  - Control verbosity with process.env.CHATBOTS_LOG_LEVEL (error|warn|info|debug). Default: info
//  - Each log line is a single JSON object (machine parsable)

import crypto from 'crypto';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const levelNames = Object.keys(LEVELS);

function resolveLevel() {
	const env = (process.env.CHATBOTS_LOG_LEVEL || 'info').toLowerCase();
	return LEVELS[env] !== undefined ? env : 'info';
}

let currentLevel = resolveLevel();

// Allow dynamic reload (optional future use)
export function setLogLevel(lvl) {
	if (LEVELS[lvl] === undefined) return false;
	currentLevel = lvl;
	return true;
}

function baseFields(extra) {
	return { ts: new Date().toISOString(), subsystem: 'chatbots', ...extra };
}

function write(level, msg, obj) {
	if (LEVELS[level] > LEVELS[currentLevel]) return;
	const line = { ...baseFields({ level, msg }), ...obj };
	// Single sink for now; can be replaced with stream writer
	process.stdout.write(JSON.stringify(line) + '\n');
}

export function createLogger(context = {}) {
	return {
		child(extra) { return createLogger({ ...context, ...extra }); },
		error(msg, meta={}) { write('error', msg, { ...context, ...meta }); },
		warn(msg, meta={})  { write('warn',  msg, { ...context, ...meta }); },
		info(msg, meta={})  { write('info',  msg, { ...context, ...meta }); },
		debug(msg, meta={}) { write('debug', msg, { ...context, ...meta }); },
		level() { return currentLevel; }
	};
}

export const logger = createLogger();

// Express middleware to attach traceId and log request lifecycle
export function requestLogger(botNameResolver) {
	return function(req, res, next) {
		req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
		const start = performance.now();
		res.setHeader('X-Trace-Id', req.traceId);
		const bot = typeof botNameResolver === 'function' ? botNameResolver(req) : botNameResolver;
		const reqLogger = logger.child({ traceId: req.traceId, bot });
		req.logger = reqLogger; // attach for downstream usage
		reqLogger.debug('request.start', { method: req.method, path: req.originalUrl });
		res.on('finish', () => {
			const ms = Math.round(performance.now() - start);
			reqLogger.info('request.finish', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: ms });
		});
		next();
	};
}

// Helper to log unexpected errors uniformly
export function logAndFormatError(err, contextLogger, extra = {}) {
	const safe = {
		name: err.name,
		message: err.message,
		stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
		...extra
	};
	contextLogger.error('unhandled.error', safe);
	return { error: safe.message, traceId: extra.traceId, code: err.code || 'ERR_UNEXPECTED' };
}

// Convenience wrapper for async route handlers to reduce try/catch repetition
export function wrapAsync(handler) {
	return async function(req, res) {
		try {
			await handler(req, res);
		} catch (err) {
			const response = logAndFormatError(err, req.logger || logger, { traceId: req.traceId });
			res.status(500).json(response);
		}
	};
}

