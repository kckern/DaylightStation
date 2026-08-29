/**
 * Loggly Transport Adapter
 *
 * Sends log events to Loggly via winston-loggly-bulk.
 * Uses winston internally for reliable bulk uploads with retry logic.
 */

import winston from 'winston';
import { Loggly } from 'winston-loggly-bulk';

/**
 * Create a Loggly transport
 * @param {Object} options
 * @param {string} options.token - Loggly customer token (required)
 * @param {string} options.subdomain - Loggly subdomain (required)
 * @param {string[]} options.tags - Tags to apply to all events (default: ['daylight'])
 * @param {number} options.bufferSize - Events to buffer before sending (default: 50)
 * @returns {Object} Transport object
 */
export function createLogglyTransport(options = {}) {
  const {
    token,
    subdomain,
    tags = ['daylight'],
    bufferSize = 50,
    acceptEvent = () => true,
  } = options;

  // Return no-op transport if not configured
  if (!token || !subdomain) {
    process.stderr.write('[LogglyTransport] Missing token or subdomain, transport disabled\n');
    return {
      name: 'loggly-disabled',
      send() {}  // No-op
    };
  }

  // Create the Loggly transport
  const logglyTransport = new Loggly({
    token,
    subdomain,
    tags,
    json: true,
    isBulk: true,
    networkErrorsOnConsole: true,
    bufferOptions: {
      size: bufferSize,
      retriesInMilliSeconds: 30000
    }
  });

  // Listen for errors on the transport
  logglyTransport.on('error', (err) => {
    process.stderr.write(`[LogglyTransport] Error: ${err.message}\n`);
  });

  // Create internal winston logger for Loggly bulk transport
  const winstonLogger = winston.createLogger({
    level: 'debug',  // Accept all levels; filtering done by dispatcher
    format: winston.format.json(),
    transports: [logglyTransport]
  });

  let lastFlush = null;
  let eventsSent = 0;

  return {
    name: 'loggly',

    send(event) {
      if (!acceptEvent(event)) return;

      winstonLogger.log(event.level, event.event, {
        ts: event.ts,
        message: event.message,
        data: event.data,
        context: event.context,
        tags: event.tags,
        _event: event.event,
        _source: event.context?.source,
        _app: event.context?.app,
        _level: event.level
      });
      eventsSent++;
    },

    flush() {
      return new Promise((resolve) => {
        lastFlush = new Date().toISOString();
        setTimeout(resolve, 100);
      });
    },

    getStatus() {
      return {
        name: 'loggly',
        status: 'ok',
        eventsSent,
        lastFlush,
        config: {
          subdomain,
          tags,
          bufferSize,
          hasToken: !!token
        }
      };
    }
  };
}

export default createLogglyTransport;
