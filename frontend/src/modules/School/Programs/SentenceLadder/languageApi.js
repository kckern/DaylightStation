/**
 * Status-aware fetch client for the canonical Sentence Ladder endpoint.
 * NOT DaylightAPI: the rungs must distinguish 403 (guest — no records kept)
 * from 500 (attempt unrecorded), and DaylightAPI hides status codes.
 * Never throws.
 *
 * Never throwing used to mean never telling anyone: a dropped WiFi, a 500 and
 * a malformed JSON body all collapsed into `{ok:false, status:0}` in a bare
 * `catch {}`, indistinguishable from each other and from a genuine status 0.
 * Every path through this file now leaves a record. `status: 0` still means
 * "nothing came back", but there is an `error`-level event beside it saying
 * what did not come back and why.
 *
 * PRIVACY: request bodies and response payloads are NEVER logged. They carry
 * the learner's own sentences and their typed answers. Paths, methods,
 * statuses, durations and byte counts only.
 */
import languageLog from './languageLog.js';

const BASE = '/api/v1/school/sentence-ladder';
const GRANT_HEADER = 'X-School-Study-Grant';
const RUN_HEADER = 'X-School-Run-Id';

/** Query strings carry only capability flags, but drop them anyway: the path
 *  is the thing you group by in the log store. */
function logPath(path) {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}

function clock() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

/** The run id rides on every request so the backend can stamp its own events
 *  with it — one `context.runId` query then returns both sides of a session. */
function withRun(headers = {}) {
  const runId = languageLog.currentRun();
  return runId ? { ...headers, [RUN_HEADER]: runId } : headers;
}

/** One place decides how a settled response is reported, so `recording` and
 *  `recordingBlob` cannot drift from `req`. */
function reportSettled(path, method, status, ok, startedAt, extra = {}) {
  const ms = Math.round(clock() - startedAt);
  const record = { path: logPath(path), method, status, ms, ...extra };
  if (ok) languageLog.api('ok', record);
  else languageLog.apiWarn('rejected', record);
}

/** An aborted request is a cancel, not a fault — a rung unmounting mid-flight
 *  is routine, and logging it at error would train us to ignore errors. */
function reportThrown(path, method, startedAt, err, extra = {}) {
  const ms = Math.round(clock() - startedAt);
  const record = {
    path: logPath(path), method, status: 0, ms,
    error: err?.message || String(err), name: err?.name || 'Error', ...extra,
  };
  if (err?.name === 'AbortError') languageLog.api('aborted', record);
  else languageLog.apiError('failed', record);
}

async function req(path, body, method, studyGrant = null, signal = undefined) {
  const verb = method || (body === undefined ? 'GET' : 'POST');
  const startedAt = clock();
  try {
    const headers = withRun(studyGrant ? { [GRANT_HEADER]: studyGrant } : {});
    const opts = body === undefined
      ? { method: verb, headers, signal }
      : {
        method: verb,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      };
    const r = await fetch(BASE + path, opts);
    // A body that will not parse is not a transport failure, but it IS a
    // failure the rungs cannot see: `data` goes null under an ok status.
    let parsed = null;
    let parseError = null;
    try {
      parsed = await r.json();
    } catch (err) {
      parseError = err?.message || String(err);
    }
    reportSettled(path, verb, r.status, r.ok, startedAt,
      parseError ? { parseError } : {});
    if (parseError && r.ok) {
      languageLog.apiWarn('unparseable', { path: logPath(path), method: verb, status: r.status, parseError });
    }
    return { ok: r.ok, status: r.status, data: parsed };
  } catch (err) {
    reportThrown(path, verb, startedAt, err);
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
    const path = `/users/${enc(userId)}/recording`;
    const startedAt = clock();
    // The child's voice itself is never logged; its size is, because "the
    // upload was 0 bytes" is the difference between a broken mic and a
    // broken route.
    const shape = { bytes: blob?.size ?? null, type: blob?.type || null };
    try {
      const ext = (blob.type || '').includes('ogg') ? 'ogg'
        : (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
      const r = await fetch(
        `${BASE}/users/${enc(userId)}/recording?corpus=${enc(corpus)}&seq=${enc(seq)}&ext=${ext}&${capabilityQuery(capabilities)}`,
        {
          method: 'POST',
          headers: withRun({ 'Content-Type': blob.type || 'audio/webm', [GRANT_HEADER]: studyGrant }),
          body: blob,
        },
      );
      const data = await r.json().catch(() => null);
      reportSettled(path, 'POST', r.status, r.ok, startedAt, shape);
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      reportThrown(path, 'POST', startedAt, err, shape);
      return { ok: false, status: 0, data: null };
    }
  },

  /**
   * A spoken answer, turned into text. Same raw-audio shape as `recording`
   * above — one file, no fields — and deliberately a DIFFERENT route: this one
   * stores nothing. The audio exists only long enough to be recognised, and
   * what comes back is a transcript the learner still has to read, edit and
   * submit through `log` like any other answer.
   *
   * `lang` is the language they are ANSWERING in, which the rung already knows
   * from `entry.response.language`. The server maps it through an allowlist
   * before it can reach a recognition prompt; nothing about the expected
   * sentence is sent, and nothing here is in a position to send it.
   */
  async transcribe(userId, corpus, seq, lang, blob, capabilities, studyGrant) {
    const path = `/users/${enc(userId)}/transcribe`;
    const startedAt = clock();
    const shape = { bytes: blob?.size ?? null, type: blob?.type || null };
    try {
      const r = await fetch(
        `${BASE}${path}?corpus=${enc(corpus)}&seq=${enc(seq)}&lang=${enc(lang)}&${capabilityQuery(capabilities)}`,
        {
          method: 'POST',
          headers: withRun({ 'Content-Type': blob.type || 'audio/webm', [GRANT_HEADER]: studyGrant }),
          body: blob,
        },
      );
      const data = await r.json().catch(() => null);
      reportSettled(path, 'POST', r.status, r.ok, startedAt, shape);
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      reportThrown(path, 'POST', startedAt, err, shape);
      return { ok: false, status: 0, data: null };
    }
  },

  audioUrl: (corpus, seq, lang) => `${BASE}/audio/${enc(corpus)}/${enc(seq)}/${enc(lang)}`,
  /** A UI cue by role (`record` = the ding before the mic goes live). The day
   *  says which roles exist; nothing here guesses a file. */
  cueUrl: (name) => `${BASE}/cue/${enc(name)}`,
  async recordingBlob(userId, corpus, seq, studyGrant) {
    const path = `/recordings/${enc(userId)}/${enc(corpus)}/${enc(seq)}`;
    const startedAt = clock();
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: withRun({ [GRANT_HEADER]: studyGrant }),
      });
      const blob = r.ok ? await r.blob() : null;
      reportSettled(path, 'GET', r.status, r.ok, startedAt, { bytes: blob?.size ?? null });
      return { ok: r.ok, status: r.status, data: blob };
    } catch (err) {
      reportThrown(path, 'GET', startedAt, err);
      return { ok: false, status: 0, data: null };
    }
  },
};

export const sentenceLadderApi = languageApi;

export default languageApi;
