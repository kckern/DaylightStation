const SESSION_PATH = /^\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

// One collector per HLS owner. Only resolved URLs observed by that engine
// identify server resources we may release; client IDs and mint parameters do
// not establish ownership of a Plex transcode session.
export function createPlexHlsSessionCleanup({ isPlex, origin, request = (...args) => fetch(...args), logger }) {
  const sessions = new Set();
  let destroyed = false;
  const report = (level, fields) => {
    try { logger?.[level]?.('video.hls.session-stop', fields); } catch { /* Cleanup must not throw. */ }
  };
  return {
    observe(rawUrl) {
      if (!isPlex || destroyed || typeof rawUrl !== 'string') return;
      try {
        const url = new URL(rawUrl, origin);
        if (url.origin !== origin || url.username || url.password) return;
        const match = SESSION_PATH.exec(url.pathname);
        if (match) sessions.add(match[1].toLowerCase());
      } catch { /* Unusable URLs confer no ownership. */ }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      const owned = [...sessions];
      sessions.clear();
      await Promise.all(owned.map(async sessionId => {
        try {
          const response = await request(`/api/v1/proxy/plex/video/:/transcode/universal/stop?session=${sessionId}`, {
            method: 'GET', credentials: 'same-origin', keepalive: true,
          });
          report(response.ok ? 'info' : 'warn', {
            sessionId, outcome: response.ok ? 'requested' : 'failed', status: response.status,
          });
        } catch {
          report('warn', { sessionId, outcome: 'failed', reason: 'request-rejected' });
        }
      }));
    },
  };
}
