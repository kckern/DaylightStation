/**
 * Global Error Handlers
 *
 * Captures uncaught errors, unhandled promise rejections, and global error events
 * and forwards them to the DaylightLogger for backend ingestion.
 */

import { getDaylightLogger } from './singleton.js';

// Track recent network errors to prevent cascade logging
const recentNetworkErrors = {
  count: 0,
  resetTime: 0,
  THRESHOLD: 3,      // After 3 errors in window, suppress
  WINDOW_MS: 2000,   // 2 second window
  // What the current window has thrown away, and one example of it. A remount
  // storm IS a fetch-failure storm, so this suppressor was deleting precisely
  // the events that described the incident and saying nothing about it. The
  // bodies are still worth dropping — hundreds of near-identical stacks help
  // nobody — but the COUNT is the diagnosis and has to survive.
  suppressedCount: 0,
  representativeMessage: null,
  flushTimer: null
};

/**
 * Report and clear the current window's suppressions.
 *
 * Called both on window rollover and from a timer, because a storm that stops
 * is a storm that never rolls over — and the last window is usually the
 * biggest one. Without the timer the loudest burst would be the silent one.
 */
function flushSuppressedNetworkErrors(logger) {
  if (recentNetworkErrors.flushTimer != null) {
    clearTimeout(recentNetworkErrors.flushTimer);
    recentNetworkErrors.flushTimer = null;
  }
  if (recentNetworkErrors.suppressedCount === 0) return;

  logger.warn('errors.suppressed', {
    kind: 'network',
    suppressedCount: recentNetworkErrors.suppressedCount,
    representativeMessage: recentNetworkErrors.representativeMessage,
    threshold: recentNetworkErrors.THRESHOLD,
    windowMs: recentNetworkErrors.WINDOW_MS
  });

  recentNetworkErrors.suppressedCount = 0;
  recentNetworkErrors.representativeMessage = null;
}

/**
 * Check if this is a network error we should suppress to prevent cascades
 * @param {*} reason - Error reason
 * @param {Object} logger - logger used for the roll-up when a window closes
 * @returns {boolean} True if should suppress
 */
function shouldSuppressNetworkError(reason, logger) {
  const message = reason?.message || String(reason);

  // Only suppress "Failed to fetch" type errors
  if (!message.includes('Failed to fetch') && !message.includes('NetworkError')) {
    return false;
  }

  const now = Date.now();

  // Reset counter if window expired
  if (now >= recentNetworkErrors.resetTime) {
    // Whatever the closing window swallowed gets reported before the new one
    // opens, so each roll-up covers exactly one window.
    flushSuppressedNetworkErrors(logger);
    recentNetworkErrors.count = 0;
    recentNetworkErrors.resetTime = now + recentNetworkErrors.WINDOW_MS;
  }

  recentNetworkErrors.count++;

  // Suppress if we've seen too many in this window
  const suppress = recentNetworkErrors.count > recentNetworkErrors.THRESHOLD;
  if (suppress) {
    recentNetworkErrors.suppressedCount++;
    // First of the window, kept verbatim: in a storm the messages are
    // near-identical, and one real example beats a count with no shape.
    if (!recentNetworkErrors.representativeMessage) {
      recentNetworkErrors.representativeMessage = message;
    }
    if (recentNetworkErrors.flushTimer == null && typeof setTimeout === 'function') {
      recentNetworkErrors.flushTimer = setTimeout(
        () => flushSuppressedNetworkErrors(logger),
        recentNetworkErrors.WINDOW_MS
      );
    }
  }
  return suppress;
}

/**
 * Set up global error handlers
 * @returns {Function} Cleanup function to remove handlers
 */
export function setupGlobalErrorHandlers() {
  const logger = getDaylightLogger();
  const handlers = [];

  // Capture uncaught errors (window.onerror)
  const onError = (message, source, lineno, colno, error) => {
    logger.error('window.onerror', {
      message: String(message),
      source,
      lineno,
      colno,
      stack: error?.stack,
      name: error?.name,
      errorType: error?.constructor?.name
    });

    // Return false to let default error handling continue
    // (browser console will still show the error)
    return false;
  };

  window.onerror = onError;
  handlers.push(() => { window.onerror = null; });

  // Capture unhandled promise rejections
  const onUnhandledRejection = (event) => {
    const reason = event.reason;

    // Suppress cascading network errors to prevent log spam
    if (shouldSuppressNetworkError(reason, logger)) {
      return;
    }

    logger.error('unhandledrejection', {
      reason: reason?.message || String(reason),
      stack: reason?.stack,
      name: reason?.name,
      promise: String(event.promise),
      errorType: reason?.constructor?.name
    });

    // Don't prevent default - let browser console show it too
  };

  window.addEventListener('unhandledrejection', onUnhandledRejection);
  handlers.push(() => {
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  });

  // Capture error events (redundant with window.onerror but catches some edge cases)
  const onErrorEvent = (event) => {
    if (event.error) {
      logger.error('window.error.event', {
        message: event.error.message,
        stack: event.error.stack,
        name: event.error.name,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        errorType: event.error.constructor?.name
      });
    }
  };

  window.addEventListener('error', onErrorEvent);
  handlers.push(() => {
    window.removeEventListener('error', onErrorEvent);
  });

  // Log that error handlers are active
  logger.info('error-handlers.initialized', {
    handlers: ['window.onerror', 'unhandledrejection', 'error-event']
  });

  // Return cleanup function
  return () => {
    handlers.forEach(cleanup => cleanup());
    // Report anything the last window swallowed before the handlers go away,
    // and leave no timer behind pointing at a logger nobody is reading.
    flushSuppressedNetworkErrors(logger);
    logger.info('error-handlers.removed', {});
  };
}

export default setupGlobalErrorHandlers;
