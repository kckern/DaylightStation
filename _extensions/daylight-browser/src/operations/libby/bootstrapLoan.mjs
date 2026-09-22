import { failure } from '../../operationRegistry.mjs';
import { installPolicy, listenUrl, validateInput } from './securityPolicy.mjs';
import { DAYLIGHT_BROWSER_TIMEOUTS } from '../../timeouts.mjs';

// Runs in the official player. Never return arbitrary page globals or storage.
export function readBookMap() {
  const map = window.BIF?.map;
  if (!map || !Array.isArray(map.spine) || !map.spine.length || map.spine.length > 1000) return null;
  const text = value => typeof value === 'string' && value.length <= 4096 ? value : null;
  const flag = value => value != null && value !== false;
  return {
    title: text(map.title), subtitle: text(map.subtitle),
    creator: Array.isArray(map.creator) ? map.creator.slice(0, 100).map(person => ({ name: text(person?.name), role: text(person?.role) })) : [],
    encryption: flag(map.encryption), license: flag(map.license),
    spine: map.spine.map(part => ({
      path: text(part?.path), 'media-type': text(part?.['media-type']),
      'audio-duration': part?.['audio-duration'], '-odread-file-bytes': part?.['-odread-file-bytes'],
      '-odread-original-path': text(part?.['-odread-original-path']),
      encryption: flag(part?.encryption), license: flag(part?.license),
    })),
  };
}

function unsupported() { throw failure('BROWSER_UNSUPPORTED_FULFILLMENT'); }
function positive(value, { integer = false } = {}) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) unsupported();
  return value;
}

function normalize(map, webUrl) {
  if (!map || map.encryption || map.license || !Array.isArray(map.spine) || !map.spine.length || map.spine.length > 1000) unsupported();
  const authorizedOrigin = listenUrl(webUrl).origin;
  const keys = new Set();
  const parts = map.spine.map((part, index) => {
    if (part['media-type'] !== 'audio/mpeg' || part.encryption || part.license || typeof part.path !== 'string' || !part.path) unsupported();
    let upstreamUrl;
    try {
      const url = listenUrl(new URL(part.path, webUrl).href);
      if (url.origin !== authorizedOrigin) unsupported();
      upstreamUrl = url.href;
    } catch { unsupported(); }
    const originalPath = part['-odread-original-path'] || new URL(upstreamUrl).pathname.split('/').pop();
    const key = String(originalPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `part-${index + 1}`;
    if (keys.has(key) || key.length > 256) unsupported();
    keys.add(key);
    return { key, index, title: `Part ${index + 1}`, duration: positive(part['audio-duration']),
      contentLength: positive(part['-odread-file-bytes'], { integer: true }), mimeType: 'audio/mpeg', upstreamUrl, headers: {} };
  });
  return { title: map.title || 'Libby audiobook', subtitle: map.subtitle || null,
    author: map.creator?.find(person => person.role === 'author')?.name || null,
    narrator: map.creator?.find(person => person.role === 'narrator')?.name || null,
    duration: parts.every(part => part.duration != null) ? parts.reduce((sum, part) => sum + part.duration, 0) : null, parts };
}

function signedCdnUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) unsupported();
  let url;
  try { url = new URL(value); } catch { unsupported(); }
  if (url.protocol !== 'https:' || url.hostname !== 'audioclips.cdn.overdrive.com' || url.port
    || url.username || url.password || url.hash) unsupported();
  return url.href;
}

export async function captureInitialPlaybackWindow(page, context, parts, webUrl, {
  signal, phaseController, fetch = globalThis.fetch, timeoutMs = DAYLIGHT_BROWSER_TIMEOUTS.captureMs,
  observationMs = DAYLIGHT_BROWSER_TIMEOUTS.captureObservationMs, maxCapabilities = 16,
} = {}) {
  if (!Array.isArray(parts) || !parts.length || typeof fetch !== 'function'
    || typeof phaseController?.beginMediaPhase !== 'function' || typeof phaseController?.endMediaPhase !== 'function'
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(observationMs) || observationMs <= 0
    || !Number.isSafeInteger(maxCapabilities) || maxCapabilities < 1 || maxCapabilities > 32) unsupported();
  const play = page.getByRole('button', { name: /^play$/i }).first();
  if (!play || !await play.isVisible?.() || !await play.isEnabled?.()) unsupported();

  const shellOrigin = listenUrl(webUrl).origin;
  const capabilities = [];
  const seen = new Set();
  const pendingPauses = new Set();
  let cdp;
  let acceptingRequests = true;
  let cdpTornDown = false;
  let pageClosing;
  let deadline;
  let observation;
  let resolveCapture;
  let rejectCapture;
  let settled = false;
  const capture = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
  // Cancellation or an intercepted request can reject capture while the
  // official click is still pending. Observe it immediately; the awaited
  // branch below still propagates the same categorical error to the caller.
  void capture.catch(() => {});
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearTimeout(observation);
    signal?.removeEventListener('abort', onAbort);
    if (error) rejectCapture(error);
    else resolveCapture([...capabilities]);
  };
  const onAbort = () => finish(failure('BROWSER_CANCELLED'));
  const beginObservation = () => {
    if (observation) return;
    observation = setTimeout(() => finish(), observationMs);
  };
  const failPaused = event => cdp?.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  const handlePaused = async event => {
    try {
      if (!acceptingRequests || event?.resourceType !== 'Media' || event?.request?.method !== 'GET') unsupported();
      let url;
      try { url = new URL(event.request.url); } catch { unsupported(); }
      let upstreamUrl;
      if (url.origin === shellOrigin && !url.username && !url.password && !url.hash && !url.port) {
        listenUrl(url.href);
      } else {
        upstreamUrl = signedCdnUrl(url.href);
        if (!seen.has(upstreamUrl)) {
          if (capabilities.length >= Math.min(parts.length, maxCapabilities)) unsupported();
          seen.add(upstreamUrl);
          capabilities.push(upstreamUrl);
          beginObservation();
        }
      }
      await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
    } catch (error) {
      await failPaused(event);
      finish(error?.code ? error : failure('BROWSER_FAILED'));
    }
  };
  const onPaused = event => {
    const work = handlePaused(event);
    pendingPauses.add(work);
    work.finally(() => pendingPauses.delete(work)).catch(() => {});
    return work;
  };
  const closePageUnderEnforcement = async () => {
    if (cdpTornDown) return;
    acceptingRequests = false;
    phaseController.endMediaPhase();
    await Promise.allSettled([...pendingPauses]);
    pageClosing ??= Promise.resolve().then(() => page.close());
    try { await pageClosing; }
    catch { throw failure('BROWSER_FAILED'); }
    // The target is now gone. Drain any last pause handler raised during close
    // before detaching the no-longer-security-critical CDP session.
    await Promise.allSettled([...pendingPauses]);
    cdpTornDown = true;
    await cdp?.send('Fetch.disable').catch(() => {});
    cdp?.off?.('Fetch.requestPaused', onPaused);
    await cdp?.detach().catch(() => {});
  };
  try {
    cdp = await context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', onPaused);
    // Enable page-CDP redirect enforcement before atomically flipping the
    // still-installed context route into its context-wide media policy.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Media', requestStage: 'Request' }] });
    phaseController.beginMediaPhase();
    deadline = setTimeout(() => finish(capabilities.length ? undefined : failure('BROWSER_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    try { await play.click({ timeout: timeoutMs }); }
    catch (error) {
      // Prefer an already-settled categorical capture failure (especially
      // cancellation) over incidental click rejection during teardown.
      if (settled) await capture;
      throw error;
    }
    const captured = await capture;
    if (!captured.length) unsupported();

    // Stop the official player before independent range validation. This
    // bounds Chromium buffering to the observation/capture window rather than
    // letting an already-continued media response run during probe work.
    await closePageUnderEnforcement();

    const resolved = [];
    const mappedIndexes = new Set();
    for (const upstreamUrl of captured) {
      if (signal?.aborted) throw failure('BROWSER_CANCELLED');
      let response;
      try {
        response = await fetch(upstreamUrl, { method: 'GET', redirect: 'manual', signal, headers: { Range: 'bytes=0-0' } });
        const contentType = response?.headers?.get?.('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        const range = response?.headers?.get?.('content-range') || '';
        const match = /^bytes 0-0\/([1-9]\d*)$/.exec(range);
        if (response?.status !== 206 || contentType !== 'audio/mpeg' || !match) unsupported();
        const total = Number(match[1]);
        if (!Number.isSafeInteger(total)) unsupported();
        const matches = parts.filter(part => part.contentLength === total);
        if (matches.length !== 1 || mappedIndexes.has(matches[0].index)) unsupported();
        mappedIndexes.add(matches[0].index);
        resolved.push(Object.freeze({ ...matches[0], upstreamUrl, headers: Object.freeze({}) }));
      } finally {
        await response?.body?.cancel?.().catch(() => {});
      }
    }
    resolved.sort((left, right) => left.index - right.index);
    if (!resolved.length || resolved.some((part, index) => index > 0 && part.index !== resolved[index - 1].index + 1)) unsupported();
    return Object.freeze(resolved.map((part, index) => Object.freeze({ ...part, index })));
  } finally {
    finish();
    await closePageUnderEnforcement();
  }
}

export async function bootstrapLoan(input, { pool, signal, captureOptions } = {}) {
  const validated = validateInput(input);
  return pool.run(async (context, { signal: operationSignal }) => {
    const page = await context.newPage();
    const phaseController = await installPolicy(context, page, validated.webUrl);
    const target = new URL(validated.webUrl);
    target.search = validated.message;
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: DAYLIGHT_BROWSER_TIMEOUTS.navigationMs });
    if (!response?.ok()) throw failure('BROWSER_FAILED');
    await page.waitForFunction(() => Array.isArray(window.BIF?.map?.spine) && window.BIF.map.spine.length > 0, null, { timeout: DAYLIGHT_BROWSER_TIMEOUTS.navigationMs });
    const normalized = normalize(await page.evaluate(readBookMap), validated.webUrl);
    const parts = await captureInitialPlaybackWindow(page, context, normalized.parts, validated.webUrl,
      { ...captureOptions, phaseController, signal: operationSignal });
    return Object.freeze({ ...normalized, parts });
  }, { signal });
}

export function createLibbyOperation(pool) {
  return { name: 'libby.bootstrap-loan', validate: validateInput, execute: (input, options) => bootstrapLoan(input, { pool, signal: options?.signal }) };
}
