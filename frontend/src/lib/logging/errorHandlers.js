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
  WINDOW_MS: 2000    // 2 second window
};

/**
 * Check if this is a network error we should suppress to prevent cascades
 * @param {*} reason - Error reason
 * @returns {boolean} True if should suppress
 */
function shouldSuppressNetworkError(reason) {
  const message = reason?.message || String(reason);
  
  // Only suppress "Failed to fetch" type errors
  if (!message.includes('Failed to fetch') && !message.includes('NetworkError')) {
    return false;
  }
  
  const now = Date.now();
  
  // Reset counter if window expired
  if (now >= recentNetworkErrors.resetTime) {
    recentNetworkErrors.count = 0;
    recentNetworkErrors.resetTime = now + recentNetworkErrors.WINDOW_MS;
  }
  
  recentNetworkErrors.count++;
  
  // Suppress if we've seen too many in this window
  return recentNetworkErrors.count > recentNetworkErrors.THRESHOLD;
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
    if (shouldSuppressNetworkError(reason)) {
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
    logger.info('error-handlers.removed', {});
  };
}

export default setupGlobalErrorHandlers;
