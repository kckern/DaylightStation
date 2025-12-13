
export class BufferResilienceManager {
  constructor(callbacks = {}) {
    this.callbacks = {
      onSeek: () => {},
      onLog: () => {},
      onGetBufferInfo: () => ({}),
      onHardReset: () => {},
      ...callbacks
    };

    this.state = {
      suppressed404: false,
      attempts: 0,
      cooldownUntil: 0,
      pendingFetch: false,
      skipped: false
    };
  }

  /**
   * Intercepts network responses to handle 404s.
   */
  handleNetworkResponse(requestType, response) {
    const status = typeof response?.status === 'number' ? response.status : null;
    const latencyMs = (() => {
      const candidate = response?.timeMs ?? response?.time ?? response?.durationMs ?? response?.tookMs ?? response?.elapsedMs;
      return Number.isFinite(candidate) ? Math.round(candidate) : null;
    })();
    const bytes = (() => {
      const candidate = response?.bytesLoaded ?? response?.totalBytes ?? response?.size ?? null;
      return Number.isFinite(candidate) ? candidate : null;
    })();

    // 1 = SEGMENT
    if (status === 404 && requestType === 1) {
      this.callbacks.onLog('warn', 'shaka-network-response', {
        requestType,
        uri: response?.uri || null,
        status,
        action: 'attempt-404-recovery'
      });

      this.state.suppressed404 = true;

      // Return a hanging promise to induce stall
      return this._induceStall(response);
    }

    this.callbacks.onLog(status && status >= 400 ? 'warn' : 'debug', 'shaka-network-response', {
      requestType,
      uri: response?.uri || null,
      originalUri: response?.originalUri || null,
      fromCache: Boolean(response?.fromCache),
      status,
      latencyMs,
      bytes
    });

    if (Number.isFinite(latencyMs) && latencyMs >= 2000 && (!status || status < 400)) {
      this.callbacks.onLog('info', 'shaka-network-slow', {
        requestType,
        uri: response?.uri || null,
        latencyMs,
        status
      });
    }
  }

  /**
   * Handles player state changes (e.g. buffering).
   */
  handlePlayerStateChange(eventName, event) {
    if (eventName === 'buffering' && event.buffering === true && this.state.suppressed404) {
      this._executeSkipStrategy();
    }
  }

  /**
   * Handles generic playback errors.
   */
  handlePlaybackError(error) {
    // Logic moved from hook to here if needed, 
    // but for now we focus on the 404 suppression flow.
    // This can be expanded to handle the retry/cooldown logic currently in the hook.
  }

  _induceStall(response) {
    return new Promise(async (resolve) => {
      const RETRY_DELAY_MS = 2000;
      
      // "Self-Healing" Strategy:
      // Instead of a fixed retry count, we retry as long as we have a healthy buffer.
      // This allows us to "patch" the missing segment if it becomes available (e.g. late live segment)
      // without interrupting playback.
      
      while (true) {
        const { bufferAheadSeconds } = this.callbacks.onGetBufferInfo();
        const safeBuffer = Number.isFinite(bufferAheadSeconds) ? bufferAheadSeconds : 0;

        // If buffer is critically low (< 2s), we can't wait anymore.
        // We stop retrying. The promise will NOT resolve, causing a stall.
        // The 'buffering' event handler will then catch this and trigger the skip.
        if (safeBuffer < 2) {
          this.callbacks.onLog('warn', 'shaka-404-buffer-exhausted', { 
            uri: response?.uri, 
            remainingBuffer: safeBuffer 
          });
          break; 
        }

        // If we have buffer, wait and retry
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        
        try {
          this.callbacks.onLog('info', 'shaka-404-retry', { 
            uri: response?.uri, 
            bufferAhead: safeBuffer 
          });
          
          const retryResponse = await fetch(response.uri);
          if (retryResponse.ok) {
            const data = await retryResponse.arrayBuffer();
            response.data = data;
            response.status = 200;
            this.state.suppressed404 = false;
            this.callbacks.onLog('warn', 'shaka-404-recovered', { uri: response?.uri });
            resolve(); // Success! Playback continues uninterrupted.
            return;
          }
        } catch (err) {
          // ignore fetch errors, loop again
        }
      }

      this.callbacks.onLog('error', 'shaka-404-hang', { uri: response?.uri });
      // Never resolve -> Stall -> Eventual Skip
    });
  }

  _executeSkipStrategy() {
    const { currentTime, bufferAheadSeconds } = this.callbacks.onGetBufferInfo();
    
    const effectiveBuffer = Number.isFinite(bufferAheadSeconds) ? bufferAheadSeconds : 0;
    const effectiveCurrent = Number.isFinite(currentTime) ? currentTime : 0;

    // If buffer is healthy (> 2s), assume error is at the edge of buffer
    const isBufferEdgeError = effectiveBuffer > 2;
    const skipBase = isBufferEdgeError ? (effectiveCurrent + effectiveBuffer) : effectiveCurrent;
    const skipTarget = Number((skipBase + 2).toFixed(3));

    this.callbacks.onLog('warn', 'shaka-recovery-action', {
      action: 'suppressed-404-skip',
      seekSeconds: skipTarget,
      bufferAhead: effectiveBuffer,
      isBufferEdgeError
    });

    this.state.suppressed404 = false;
    
    // Use hardReset for now as it's the most reliable way to clear the hung request
    this.callbacks.onHardReset({ seekToSeconds: skipTarget });
  }
}
