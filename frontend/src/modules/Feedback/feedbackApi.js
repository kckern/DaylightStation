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

const TERMINAL_TRANSCRIPT = new Set(['done', 'failed', 'unavailable']);

/**
 * Poll the feedback item until its transcript reaches a terminal status or we
 * hit the timeout. Resolves the full item; on timeout resolves a marker with
 * transcriptStatus:'timeout' (the item is saved regardless). NOTE: the GET must
 * be called with NO body — DaylightAPI promotes any GET with a body to POST.
 */
export async function pollFeedbackTranscript({ app, id, timeoutMs = 20000, intervalMs = 1500 } = {}) {
  const path = `api/v1/feedback/${app}/${id}`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    last = await DaylightAPI(path);
    if (last && TERMINAL_TRANSCRIPT.has(last.transcriptStatus)) return last;
    if (Date.now() >= deadline) return { ...(last || { id, app }), transcriptStatus: 'timeout' };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Discard a saved feedback item (used by the overlay's Redo path). */
export async function deleteFeedback({ app, id } = {}) {
  return DaylightAPI(`api/v1/feedback/${app}/${id}`, {}, 'DELETE');
}
