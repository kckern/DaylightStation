/** Sentence Ladder endpoints retain run correlation, status codes and raw recording bodies.
 * Transport diagnostics never include grants, response payloads or exception text.
 */
import languageLog from './languageLog.js';
import { createSchoolEndpointClient } from '../../runtime/schoolEndpointClient.js';

const BASE = '/api/v1/school/sentence-ladder';
const GRANT_HEADER = 'X-School-Study-Grant';
const RUN_HEADER = 'X-School-Run-Id';
const enc = encodeURIComponent;
const clock = () => typeof performance?.now === 'function' ? performance.now() : Date.now();

function capabilityQuery(capabilities = {}) {
  const params = new URLSearchParams();
  if (capabilities.microphone) params.set('microphone', 'true');
  if (capabilities.textInput?.length) params.set('textInput', capabilities.textInput.join(','));
  return params;
}

function withRun(headers = {}) {
  const runId = languageLog.currentRun();
  return runId ? { ...headers, [RUN_HEADER]: runId } : headers;
}

function report(path, method, result, startedAt, extra = {}) {
  const record = { path: path.split('?')[0], method, status: result.status, ms: Math.round(clock() - startedAt), ...extra };
  if (result.error?.kind === 'aborted') languageLog.api('aborted', record);
  else if (!result.status) languageLog.apiError('failed', { ...record, error: result.error?.kind ?? 'network' });
  else if (!result.ok) languageLog.apiWarn('rejected', record);
  else languageLog.api('ok', record);
  if (result.error?.kind === 'invalid-json') languageLog.apiWarn('unparseable', record);
}

export function createLanguageApi(options = {}) {
  const client = createSchoolEndpointClient({ ...options, base: BASE });
  async function req(path, body, method, studyGrant = null, signal) {
    const verb = method || (body === undefined ? 'GET' : 'POST');
    const startedAt = clock();
    const result = await client.request(path, { body, method: verb, signal, headers: withRun(studyGrant ? { [GRANT_HEADER]: studyGrant } : {}) });
    report(path, verb, result, startedAt);
    return client.finish(result);
  }
  async function blobAt(path, headers = {}) {
    const startedAt = clock();
    const result = await client.request(path, { headers: withRun(headers), responseType: 'blob' });
    if (!result.ok) result.data = null;
    report(path, 'GET', result, startedAt, { bytes: result.data?.size ?? null });
    return client.finish(result);
  }
  async function audioPost(path, blob, studyGrant) {
    const startedAt = clock();
    const result = await client.request(path, {
      method: 'POST', body: blob, raw: true,
      headers: withRun({ 'Content-Type': blob.type || 'audio/webm', [GRANT_HEADER]: studyGrant }),
    });
    report(path, 'POST', result, startedAt, { bytes: blob?.size ?? null, type: blob?.type || null });
    return client.finish(result);
  }

  return {
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
    const type = blob.type || '';
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : type.includes('wav') ? 'wav' : 'webm';
    return audioPost(`/users/${enc(userId)}/recording?corpus=${enc(corpus)}&seq=${enc(seq)}&ext=${ext}&${capabilityQuery(capabilities)}`, blob, studyGrant);
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
    return audioPost(`/users/${enc(userId)}/transcribe?corpus=${enc(corpus)}&seq=${enc(seq)}&lang=${enc(lang)}&${capabilityQuery(capabilities)}`, blob, studyGrant);
  },

  audioUrl: (corpus, seq, lang) => `${BASE}/audio/${enc(corpus)}/${enc(seq)}/${enc(lang)}`,
  /** A UI cue by role (`record` = the ding before the mic goes live). The day
   *  says which roles exist; nothing here guesses a file. */
  cueUrl: (name) => `${BASE}/cue/${enc(name)}`,
  recordingBlob: (userId, corpus, seq, studyGrant) => blobAt(
    `/recordings/${enc(userId)}/${enc(corpus)}/${enc(seq)}`, { [GRANT_HEADER]: studyGrant },
  ),

  // -- the teacher console's reads ----------------------------------------
  // Same history, for the picked teacher (`by`) instead of a launch grant.
  teacherCourses: (learnerId, by) => req(`/teacher/${enc(learnerId)}/courses?by=${enc(by ?? '')}`),
  teacherHistory: (learnerId, corpus, by) => req(`/teacher/${enc(learnerId)}/history?corpus=${enc(corpus)}&by=${enc(by ?? '')}`),
  teacherRecordingBlob: (learnerId, corpus, seq, by) => blobAt(
    `/teacher/${enc(learnerId)}/recordings/${enc(corpus)}/${enc(seq)}?by=${enc(by ?? '')}`,
  ),
};

}

export const createSentenceLadderApi = createLanguageApi;
export const languageApi = createLanguageApi();
export const sentenceLadderApi = languageApi;
export default languageApi;
