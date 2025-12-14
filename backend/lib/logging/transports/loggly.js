/**
 * Loggly Transport
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
 * @param {number} options.bufferSize - Events to buffer before sending (default: 1)
 * @returns {Object} Transport object
 */
export function createLogglyTransport(options = {}) {
  const { 
    token, 
    subdomain, 
    tags = ['daylight'], 
    bufferSize = 50 
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
  const startupState = new Map(); // key -> { firstSent: bool, finalSent: bool }

  return {
    name: 'loggly',
    
    /**
     * Send a log event to Loggly
     * @param {Object} event - Normalized log event
     */
    send(event) {
      // Throttle ultra-high-frequency startup metrics before hitting Loggly
      if (event?.event === 'playback.media-metric' && event?.data?.metric === 'startup_duration_ms') {
        const key = event?.data?.waitKey || event?.context?.sessionId || 'global-startup-metric';
        const state = startupState.get(key) || { firstSent: false, finalSent: false };

        const isFinal = event?.data?.final === true || event?.data?.isFinal === true;

        // Only send first and final samples per waitKey
        if (!state.firstSent) {
          startupState.set(key, { firstSent: true, finalSent: state.finalSent });
        } else if (isFinal && !state.finalSent) {
          startupState.set(key, { ...state, finalSent: true });
        } else {
          return; // drop intermediate samples
        }

        // Prevent unbounded growth in long-lived processes
        if (startupState.size > 2000) {
          startupState.clear();
        }
      }

      // Winston expects (level, message, meta)
      // We pass the event name as the message and include full event as meta
      winstonLogger.log(event.level, event.event, {
        ts: event.ts,
        message: event.message,
        data: event.data,
        context: event.context,
        tags: event.tags,
        // Flatten key fields for better Loggly search
        _event: event.event,
        _source: event.context?.source,
        _app: event.context?.app,
        _level: event.level
      });
      eventsSent++;
    },
    
    /**
     * Flush pending events
     * @returns {Promise<void>}
     */
    flush() {
      return new Promise((resolve) => {
        // winston-loggly-bulk doesn't expose a flush method directly
        // With bufferSize=1, events are sent immediately
        // Small delay to allow any in-flight requests to complete
        lastFlush = new Date().toISOString();
        setTimeout(resolve, 100);
      });
    },

    /**
     * Get transport status
     * @returns {Object}
     */
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
