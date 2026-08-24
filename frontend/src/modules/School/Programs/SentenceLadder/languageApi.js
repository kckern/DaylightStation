/**
 * Status-aware fetch client for /api/v1/school/language, mirroring schoolApi.js.
 * NOT DaylightAPI: the rungs must distinguish 403 (guest — no records kept)
 * from 500 (attempt unrecorded), and DaylightAPI hides status codes.
 * Never throws.
 */
const BASE = '/api/v1/school/language';

async function req(path, body, method) {
  try {
    const opts = body === undefined
      ? { method: method || 'GET' }
      : {
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      };
    const r = await fetch(BASE + path, opts);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Capabilities describe the device in the learner's hands, so they ride along
 * on every request. `textInput` is a list of language codes, not a boolean:
 * typing Hangul and typing English are different capabilities.
 */
function capabilityQuery(capabilities = {}) {
  const params = new URLSearchParams();
  if (capabilities.microphone) params.set('microphone', 'true');
  if (capabilities.textInput?.length) params.set('textInput', capabilities.textInput.join(','));
  return params;
}

const enc = encodeURIComponent;

export const languageApi = {
  courses: () => req('/courses'),

  day: (userId, corpus, capabilities) => {
    const params = capabilityQuery(capabilities);
    params.set('corpus', corpus);
    return req(`/users/${enc(userId)}/day?${params}`);
  },

  log: (userId, body) => req(`/users/${enc(userId)}/log`, body),

  pacing: (userId, corpus, dailyLimit) => req(`/users/${enc(userId)}/pacing`, { corpus, dailyLimit }, 'PUT'),

  roll: (userId, corpus, capabilities) => {
    const params = capabilityQuery(capabilities);
    return req(`/users/${enc(userId)}/roll?${params}`, { corpus });
  },

  history: (userId, corpus) => req(`/users/${enc(userId)}/history?corpus=${enc(corpus)}`),

  /** Raw audio body rather than multipart — one file, no fields. */
  async recording(userId, corpus, seq, blob) {
    try {
      const ext = (blob.type || '').includes('ogg') ? 'ogg'
        : (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
      const r = await fetch(
        `${BASE}/users/${enc(userId)}/recording?corpus=${enc(corpus)}&seq=${enc(seq)}&ext=${ext}`,
        { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob },
      );
      const data = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  },

  audioUrl: (corpus, seq, lang) => `${BASE}/audio/${enc(corpus)}/${enc(seq)}/${enc(lang)}`,
  recordingUrl: (userId, corpus, seq) => `${BASE}/recordings/${enc(userId)}/${enc(corpus)}/${enc(seq)}`,
};

export default languageApi;
