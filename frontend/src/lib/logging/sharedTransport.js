/**
 * Shared WebSocket transport for logging
 * 
 * Provides a singleton buffering WebSocket transport that is shared between
 * Logger.js and singleton.js to prevent duplicate connections.
 * 
 * Uses tier-based throttling (1s → 15min) to handle backend disconnections
 * without spiraling into memory leaks.
 */

import { createBufferingWebSocketTransport } from './index.js';

let sharedWsTransport = null;
let currentConfig = null;

/**
 * Get or create the shared WebSocket transport
 * @param {Object} options - Transport configuration
 * @returns {Object|null} Transport instance or null if not available
 */
export const getSharedWsTransport = (options = {}) => {
  const config = {
    topic: options.topic || 'logging',
    maxQueue: options.maxQueue || 500,
    batchSize: options.batchSize || 20,
    flushInterval: options.flushInterval || 1000,
    url: options.url || options.websocketUrl
  };
  
  // Check if we need to recreate the transport (URL changed)
  const configChanged = currentConfig && (
    currentConfig.url !== config.url ||
    currentConfig.topic !== config.topic
  );
  
  if (configChanged) {
    // Close old transport and recreate
    sharedWsTransport = null;
    currentConfig = null;
  }
  
  if (!sharedWsTransport) {
    currentConfig = config;
    sharedWsTransport = createBufferingWebSocketTransport(config);
  }
  
  return sharedWsTransport;
};

/**
 * Reset the shared transport (useful for testing)
 */
export const resetSharedTransport = () => {
  sharedWsTransport = null;
  currentConfig = null;
};
