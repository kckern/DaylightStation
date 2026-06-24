import { DaylightAPI } from '../../lib/api.mjs';
import getLogger, { getRecentEvents } from '../../lib/logging/Logger.js';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Submit a voice-feedback item. Bundles the audio with a snapshot of the last
 * ~150 client log events (captured before they rotate) plus a pointer to the
 * persisted app session log, and the current route/context — so each item is
 * triageable with the surrounding evidence.
 *
 * @param {object} p
 * @param {string} p.app      - originating app slug (e.g. 'piano')
 * @param {Blob}   p.blob     - recorded audio
 * @param {number} p.durationMs
 * @param {object} [p.context] - app-specific context merged with route
 */
export async function submitFeedback({ app, blob, durationMs = 0, context = {} }) {
  const audioBase64 = blob ? await blobToBase64(blob) : null;
  const fullContext = {
    route: typeof window !== 'undefined' ? window.location?.pathname : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    ...context,
  };
  const logs = {
    appLogDir: `media/logs/${app}`, // pointer for fetching full detail later
    capturedAt: new Date().toISOString(),
    recent: getRecentEvents(150),
  };
  getLogger().child({ component: 'feedback' }).info('feedback.submit', { app, durationMs, logEvents: logs.recent.length });
  return DaylightAPI('api/v1/feedback', {
    app,
    audioBase64,
    mimeType: blob?.type || 'audio/webm',
    durationMs,
    context: fullContext,
    logs,
  }, 'POST');
}

export default submitFeedback;
