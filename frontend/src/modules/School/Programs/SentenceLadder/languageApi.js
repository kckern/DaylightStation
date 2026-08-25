/**
 * Status-aware fetch client for the canonical Sentence Ladder endpoint.
 * NOT DaylightAPI: the rungs must distinguish 403 (guest — no records kept)
 * from 500 (attempt unrecorded), and DaylightAPI hides status codes.
 * Never throws.
 */
const BASE = '/api/v1/school/sentence-ladder';
const GRANT_HEADER = 'X-School-Study-Grant';

async function req(path, body, method, studyGrant = null, signal = undefined) {
  try {
    const headers = studyGrant ? { [GRANT_HEADER]: studyGrant } : {};
    const opts = body === undefined
      ? { method: method || 'GET', headers, signal }
      : {
        method: method || 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
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

  previewDay: (corpus, capabilities, signal) => {
    const params = capabilityQuery(capabilities);
    return req(`/preview/${enc(corpus)}/day?${params}`, undefined, undefined, null, signal);
  },

  day: (userId, corpus, capabilities, studyGrant, signal) => {
    const params = capabilityQuery(capabilities);
    params.set('corpus', corpus);
    return req(`/users/${enc(userId)}/day?${params}`, undefined, undefined, studyGrant, signal);
  },

  log: (userId, body, capabilities, studyGrant) => {
    const params = capabilityQuery(capabilities);
    return req(`/users/${enc(userId)}/log?${params}`, body, undefined, studyGrant);
  },

  pacing: (userId, corpus, dailyLimit, studyGrant) => req(`/users/${enc(userId)}/pacing`, { corpus, dailyLimit }, 'PUT', studyGrant),

  roll: (userId, corpus, capabilities, studyGrant) => {
    const params = capabilityQuery(capabilities);
    return req(`/users/${enc(userId)}/roll?${params}`, { corpus }, undefined, studyGrant);
  },

  history: (userId, corpus, studyGrant) => req(`/users/${enc(userId)}/history?corpus=${enc(corpus)}`, undefined, undefined, studyGrant),

  /** Raw audio body rather than multipart — one file, no fields. */
  async recording(userId, corpus, seq, blob, capabilities, studyGrant) {
    try {
      const ext = (blob.type || '').includes('ogg') ? 'ogg'
        : (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
      const r = await fetch(
        `${BASE}/users/${enc(userId)}/recording?corpus=${enc(corpus)}&seq=${enc(seq)}&ext=${ext}&${capabilityQuery(capabilities)}`,
        { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', [GRANT_HEADER]: studyGrant }, body: blob },
      );
      const data = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  },

  audioUrl: (corpus, seq, lang) => `${BASE}/audio/${enc(corpus)}/${enc(seq)}/${enc(lang)}`,
  async recordingBlob(userId, corpus, seq, studyGrant) {
    try {
      const r = await fetch(`${BASE}/recordings/${enc(userId)}/${enc(corpus)}/${enc(seq)}`, {
        headers: { [GRANT_HEADER]: studyGrant },
      });
      return { ok: r.ok, status: r.status, data: r.ok ? await r.blob() : null };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  },
};

export const sentenceLadderApi = languageApi;

export default languageApi;
