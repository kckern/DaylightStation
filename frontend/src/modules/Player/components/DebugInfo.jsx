import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { mapReadyState, mapNetworkState } from '../lib/helpers.js';

/**
 * Debug information component for diagnosing media loading issues
 * Tracks network requests, errors, and media element state
 */
export function DebugInfo({ 
  show, 
  debugContext, 
  getMediaEl, 
  stalled,
  plexId 
}) {
  const [debugSnapshot, setDebugSnapshot] = useState(null);
  const [networkErrors, setNetworkErrors] = useState([]);
  const [pendingRequests, setPendingRequests] = useState(new Map());

  // Monitor network requests and errors
  useEffect(() => {
    const errors = [];
    const pending = new Map();
    const maxErrors = 10;
    
    // Intercept fetch with pending tracking
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = args[0];
      const requestId = `${Date.now()}-${Math.random()}`;
      const startTime = Date.now();
      
      if (url?.includes?.('plex_proxy') || url?.includes?.('playable')) {
        pending.set(requestId, {
          url,
          startTime,
          type: 'fetch'
        });
        setPendingRequests(new Map(pending));
      }
      
      try {
        const response = await originalFetch(...args);
        pending.delete(requestId);
        setPendingRequests(new Map(pending));
        
        if (!response.ok && (url?.includes?.('plex_proxy') || url?.includes?.('playable'))) {
          const duration = Date.now() - startTime;
          errors.push({
            type: 'fetch',
            url,
            status: response.status,
            statusText: response.statusText,
            duration,
            timestamp: new Date().toISOString()
          });
          if (errors.length > maxErrors) errors.shift();
          setNetworkErrors([...errors]);
        }
        return response;
      } catch (err) {
        pending.delete(requestId);
        setPendingRequests(new Map(pending));
        
        if (url?.includes?.('plex_proxy') || url?.includes?.('playable')) {
          const duration = Date.now() - startTime;
          errors.push({
            type: 'fetch-error',
            url,
            error: err.message,
            duration,
            timestamp: new Date().toISOString()
          });
          if (errors.length > maxErrors) errors.shift();
          setNetworkErrors([...errors]);
        }
        throw err;
      }
    };

    // Intercept XMLHttpRequest with pending tracking
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._url = url;
      this._method = method;
      return originalOpen.call(this, method, url, ...rest);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
      const url = this._url;
      const requestId = `${Date.now()}-${Math.random()}`;
      const startTime = Date.now();
      
      if (url?.includes?.('plex_proxy')) {
        this._requestId = requestId;
        this._startTime = startTime;
        pending.set(requestId, {
          url,
          startTime,
          type: 'xhr',
          method: this._method
        });
        setPendingRequests(new Map(pending));
      }
      
      this.addEventListener('error', () => {
        if (this._requestId) {
          pending.delete(this._requestId);
          setPendingRequests(new Map(pending));
        }
        if (url?.includes?.('plex_proxy')) {
          const duration = Date.now() - startTime;
          errors.push({
            type: 'xhr-error',
            url,
            error: 'Network request failed',
            duration,
            timestamp: new Date().toISOString()
          });
          if (errors.length > maxErrors) errors.shift();
          setNetworkErrors([...errors]);
        }
      });
      
      this.addEventListener('load', () => {
        if (this._requestId) {
          pending.delete(this._requestId);
          setPendingRequests(new Map(pending));
        }
        if (this.status >= 400 && url?.includes?.('plex_proxy')) {
          const duration = Date.now() - startTime;
          errors.push({
            type: 'xhr',
            url,
            status: this.status,
            statusText: this.statusText,
            duration,
            timestamp: new Date().toISOString()
          });
          if (errors.length > maxErrors) errors.shift();
          setNetworkErrors([...errors]);
        }
      });
      
      return originalSend.call(this, ...args);
    };

    return () => {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
    };
  }, []);

  // Build a snapshot of media element state for debugging
  useEffect(() => {
    if (!show) return;
    
    const collect = () => {
      const el = typeof getMediaEl === 'function' ? getMediaEl() : null;
      const err = el?.error ? (el.error.message || el.error.code) : undefined;
      const bufferedEnd = (() => { 
        try { 
          return el?.buffered?.length ? el.buffered.end(el.buffered.length - 1).toFixed(2) : undefined; 
        } catch { 
          return undefined; 
        } 
      })();
      
      // Determine the main issue
      let mainIssue = 'Unknown - media not loading';
      let issueDetails = [];
      
      // Check for pending requests first (most common issue)
      const pendingArray = Array.from(pendingRequests.values());
      if (pendingArray.length > 0) {
        const oldestPending = pendingArray.sort((a, b) => a.startTime - b.startTime)[0];
        const pendingDuration = ((Date.now() - oldestPending.startTime) / 1000).toFixed(1);
        const urlPart = oldestPending.url?.split('?')[0]?.split('/').pop() || 'request';
        
        mainIssue = `Waiting for server response (${pendingDuration}s)`;
        issueDetails.push(`🕐 Pending: ${urlPart}`);
        issueDetails.push(`${pendingArray.length} request${pendingArray.length > 1 ? 's' : ''} pending`);
        
        if (pendingDuration > 10) {
          issueDetails.push('→ Server response is very slow');
          issueDetails.push('→ Check backend is running and network connection');
        } else if (pendingDuration > 5) {
          issueDetails.push('→ Server taking longer than expected');
        }
        
        // Show what we're waiting for
        if (urlPart.includes('playable')) {
          issueDetails.push('→ Waiting for media info from backend');
        } else if (urlPart.includes('.mpd')) {
          issueDetails.push('→ Waiting for DASH manifest');
        } else if (urlPart.includes('transcode')) {
          issueDetails.push('→ Waiting for transcode session');
        }
      } else if (networkErrors.length > 0) {
        const latest = networkErrors[networkErrors.length - 1];
        mainIssue = `HTTP ${latest.status || 'Error'}: ${latest.statusText || latest.error || 'Request failed'}`;
        issueDetails.push(`❌ Latest error from: ${latest.url?.split('/').pop()}`);
        
        // Analyze error patterns
        const statuses = networkErrors.map(e => e.status).filter(Boolean);
        const uniqueStatuses = [...new Set(statuses)];
        if (uniqueStatuses.length > 0) {
          issueDetails.push(`HTTP Status codes seen: ${uniqueStatuses.join(', ')}`);
        }
        
        // Count recent errors
        const recentCount = networkErrors.filter(e => {
          const age = Date.now() - new Date(e.timestamp).getTime();
          return age < 10000; // Last 10 seconds
        }).length;
        issueDetails.push(`Recent errors (10s): ${recentCount}`);
        
        // Suggest actions based on status
        if (latest.status === 404) {
          issueDetails.push('→ Media file not found on server');
        } else if (latest.status === 400) {
          issueDetails.push('→ Bad request - check media URL/parameters');
        } else if (latest.status === 401 || latest.status === 403) {
          issueDetails.push('→ Authentication/authorization issue');
        } else if (latest.status >= 500) {
          issueDetails.push('→ Server error - check backend logs');
        }
      } else if (err) {
        mainIssue = `Media Error: ${err}`;
        issueDetails.push('→ Check console for detailed error message');
      } else if (!el) {
        mainIssue = 'Media element not found';
        issueDetails.push('→ Video player not initialized properly');
      } else if (el?.readyState === 0) {
        mainIssue = 'Media element has no source';
        issueDetails.push('→ Waiting for media URL to be set');
        if (el?.src || el?.currentSrc) {
          issueDetails.push(`→ Source: ${(el.src || el.currentSrc).substring(0, 60)}...`);
        }
      } else if (el?.readyState === 1) {
        mainIssue = 'Loading metadata...';
        issueDetails.push('→ Media source found, loading metadata');
      } else if (el?.readyState === 2) {
        mainIssue = 'Buffering current frame';
        issueDetails.push('→ Metadata loaded, waiting for enough data');
      } else if (stalled) {
        mainIssue = 'Playback stalled';
        issueDetails.push('→ Check network connection or buffer issues');
      } else {
        // No obvious error, check what state we're in
        issueDetails.push(`Ready state: ${mapReadyState(el?.readyState)}`);
        issueDetails.push(`Network state: ${mapNetworkState(el?.networkState)}`);
      }
      
      setDebugSnapshot({
        when: new Date().toISOString(),
        plexId: plexId || null,
        mainIssue,
        issueDetails: issueDetails.length > 0 ? issueDetails : undefined,
        context: debugContext || {},
        pendingRequests: Array.from(pendingRequests.values()).map(p => ({
          url: p.url?.substring(p.url?.lastIndexOf('/') + 1, p.url?.indexOf('?') > 0 ? p.url?.indexOf('?') : undefined) || p.url,
          duration: ((Date.now() - p.startTime) / 1000).toFixed(1) + 's',
          type: p.type,
          method: p.method
        })),
        networkErrors: networkErrors.slice(-3).map(e => ({
          status: e.status,
          url: e.url?.substring(e.url?.lastIndexOf('/') + 1, e.url?.indexOf('?') > 0 ? e.url?.indexOf('?') : undefined) || e.url,
          duration: e.duration ? (e.duration / 1000).toFixed(2) + 's' : undefined,
          time: e.timestamp
        })),
        elPresent: !!el,
        readyState: el?.readyState,
        readyStateText: mapReadyState(el?.readyState),
        networkState: el?.networkState,
        networkStateText: mapNetworkState(el?.networkState),
        paused: el?.paused,
        seeking: el?.seeking,
        ended: el?.ended,
        currentTime: el?.currentTime,
        duration: el?.duration,
        bufferedEnd,
        src: el?.getAttribute?.('src')?.substring(0, 100) + '...',
        currentSrc: el?.currentSrc?.substring(0, 100) + '...',
        error: err,
        stalled
      });
    };
    
    collect();
    const id = setInterval(collect, 1000);
    return () => clearInterval(id);
  }, [show, getMediaEl, debugContext, stalled, networkErrors, pendingRequests, plexId]);

  if (!show || !debugSnapshot) {
    return null;
  }

  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ 
        fontSize: '1.2em', 
        fontWeight: 'bold', 
        marginBottom: '10px',
        color: '#ff6b6b',
        borderBottom: '2px solid #ff6b6b',
        paddingBottom: '5px'
      }}>
        ⚠️ {debugSnapshot.mainIssue}
      </div>
      {debugSnapshot.issueDetails && (
        <div style={{ 
          marginBottom: '15px',
          padding: '10px',
          backgroundColor: 'rgba(255, 107, 107, 0.1)',
          borderRadius: '4px'
        }}>
          {debugSnapshot.issueDetails.map((detail, i) => (
            <div key={i} style={{ margin: '5px 0' }}>{detail}</div>
          ))}
        </div>
      )}
      <details style={{ marginTop: '10px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
          Technical Details
        </summary>
        <pre style={{ 
          marginTop: '10px',
          whiteSpace: 'pre-wrap', 
          fontSize: '0.85em',
          maxHeight: '300px',
          overflow: 'auto'
        }}>
{JSON.stringify(debugSnapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}

DebugInfo.propTypes = {
  show: PropTypes.bool,
  debugContext: PropTypes.object,
  getMediaEl: PropTypes.func,
  stalled: PropTypes.bool,
  plexId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
};
