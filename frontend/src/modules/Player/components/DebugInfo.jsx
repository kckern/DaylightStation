import React, { useState, useEffect } from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import axios from 'axios';


const checkUrlStatus = async (url, config={}) => {
  const { code = 200, yellowAfter = 500, timeout = 8000 } = config;
  const start = Date.now();
  try {
    const response = await axios.get(url, { timeout });
    const ms = Date.now() - start;
    return { ok: response.status >= code && response.status < 300, ms, status: ms < yellowAfter ? 'green' : 'yellow' };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, status: 'red', error: error?.message };
  }
};



  /*
  Checks:
   1. Internet is up
   2. Daylightstation Server is reachable
   3. DaylightSTation API is responsive
   5. Media Info URL is reachable
   6. MPD/Media URL is reachable

  */

const checkInternet       = () => checkUrlStatus('http://www.msftncsi.com/ncsi.txt');
const checkDaylightServer = () => checkUrlStatus(DaylightMediaPath('/api/v1/ping'));
const checkDaylightAPI    = () => checkUrlStatus(DaylightMediaPath('/api/v1/status'));
const checkMediaInfoURL   = (plexId) => checkUrlStatus(DaylightMediaPath(`/api/v1/info/plex/${plexId}`));
const checkMediaURL       = (plexId) => checkUrlStatus(DaylightMediaPath(`/api/v1/play/plex/${plexId}`));

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

  return false;
   const [connectionInternet, setConnectionInternet] = useState(null);
   const [connectionDaylightServer, setConnectionDaylightServer] = useState(null);
   const [connectionDaylightAPI, setConnectionDaylightAPI] = useState(null);
   const [connectionMediaInfo, setConnectionMediaInfo] = useState(null);
   const [connectionMediaURL, setConnectionMediaURL] = useState(null);

   useEffect(() => {
     if (!show) return;

     checkInternet().then(result => {
       setConnectionInternet(result);
     });
     
     checkDaylightServer().then(result => {
       setConnectionDaylightServer(result);
     });
     
     checkDaylightAPI().then(result => {
       setConnectionDaylightAPI(result);
     });
     
     if (plexId) {
       checkMediaInfoURL(plexId).then(result => {
         setConnectionMediaInfo(result);
       });
       checkMediaURL(plexId).then(result => {
         setConnectionMediaURL(result);
       });
     } else {
       // Set timeout fallback for media checks when no plexId
       const timeout = setTimeout(() => {
         if (!connectionMediaInfo) {
           setConnectionMediaInfo({ ok: false, ms: 0, status: 'red', error: 'No plexId provided' });
         }
         if (!connectionMediaURL) {
           setConnectionMediaURL({ ok: false, ms: 0, status: 'red', error: 'No plexId provided' });
         }
       }, 5000);
       return () => clearTimeout(timeout);
     }
   }, [show, plexId]);

  const getStatusCircle = (result) => {
    const colors = {
      green: '#4ade80',
      yellow: '#fbbf24',
      red: '#ef4444',
      gray: '#9ca3af'
    };
    const color = !result ? colors.gray : colors[result.status] || colors.gray;
    
    return (
      <svg width="2em" height="2em" viewBox="0 0 100 100" style={{ display: 'block', margin: '0 auto', filter: 'none' }}>
        <defs>
          <filter id={`glow-${result?.status || 'gray'}`}>
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle 
          cx="50" 
          cy="50" 
          r="40" 
          fill={color}
          filter={`url(#glow-${result?.status || 'gray'})`}
        />
      </svg>
    );
  };

  const checks = [
 //   { label: 'Internet', result: connectionInternet },
    { label: 'Server', result: connectionDaylightServer },
    { label: 'API', result: connectionDaylightAPI },
    { label: 'Media Info', result: connectionMediaInfo },
    { label: 'Media URL', result: connectionMediaURL },
  ];

  return (
    <div className="debug-status-indicators" style={{ textAlign: 'left', padding: '15px' }}>
      <div style={{ 
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '15px',
        marginBottom: '20px'
      }}>
        {checks.map(({ label, result }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '5px' }}>
              {getStatusCircle(result)}
            </div>
            <div style={{ fontSize: '0.9em', fontWeight: '500' }}>
              {label}
            </div>
            {result && (
              <div style={{ fontSize: '0.75em', color: '#999', marginTop: '2px' }}>
                {result.ms}ms
              </div>
            )}
          </div>
        ))}
      </div>
      
    </div>
  );
}
