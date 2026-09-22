import { pathToFileURL } from 'node:url';

const emptyEvidence = () => ({ success: false, title: null, partCount: 0, duration: 0, mimeTypes: [], coverMimeType: null });
const silentLogger = { warn() {}, info() {}, error() {}, debug() {} };

async function defaultRuntimeFactory(options) {
  const { createLibbyRuntime } = await import('../../../../backend/src/5_composition/modules/libby.mjs');
  return createLibbyRuntime(options);
}

async function cancel(opened) {
  try { await opened?.body?.cancel?.(); }
  finally { await opened?.cleanup?.(); }
}

/** Backend-side, opt-in integration: never starts an HTTP server or consumes media bodies. */
export async function runLiveProbe({ env = process.env, runtimeFactory = defaultRuntimeFactory, fetch = globalThis.fetch } = {}) {
  const evidence = emptyEvidence();
  if (env.LIBBY_LIVE !== '1' || !env.LIBBY_LIVE_DATA_PATH || !env.LIBBY_LIVE_USERNAME
    || !/^\d+$/.test(env.LIBBY_LIVE_CARD_ID || '') || !/^\d+$/.test(env.LIBBY_LIVE_TITLE_ID || '')
    || !env.DAYLIGHT_BROWSER_URL) return evidence;
  let runtime;
  const signal = AbortSignal.timeout(90_000);
  try {
    runtime = await runtimeFactory({ dataPath: env.LIBBY_LIVE_DATA_PATH, username: env.LIBBY_LIVE_USERNAME,
      browserBaseUrl: env.DAYLIGHT_BROWSER_URL, fetch, logger: silentLogger });
    const identity = { cardId: env.LIBBY_LIVE_CARD_ID, titleId: env.LIBBY_LIVE_TITLE_ID, signal };
    const loan = await runtime.client.openLoan(identity);
    if (!loan.parts?.length || loan.parts.some(part => part.mimeType !== 'audio/mpeg'
      || !Number.isFinite(part.duration) || part.duration <= 0) || typeof loan.title !== 'string') return evidence;
    const duration = loan.parts.reduce((total, part) => total + part.duration, 0);
    if (!Number.isFinite(duration)) return evidence;
    const { handle } = runtime.leases.issue({ loan, part: loan.parts[0] });
    const stream = await runtime.streamService.open({ handle, method: 'GET', range: 'bytes=0-0', signal });
    await cancel(stream);
    if (stream.kind !== 'opened' || stream.status !== 206 || stream.contentType?.split(';')[0] !== 'audio/mpeg'
      || !/^bytes 0-0\/[1-9]\d*$/.test(stream.contentRange || '') || String(stream.contentLength) !== '1') return evidence;
    const cover = await runtime.coverService.open(identity);
    await cancel(cover);
    const coverMimeType = cover.contentType?.split(';')[0];
    if (cover.kind !== 'opened' || !/^image\/[a-z0-9.+-]+$/i.test(coverMimeType || '')) return evidence;
    return { success: true, title: loan.title, partCount: loan.parts.length, duration,
      mimeTypes: [...new Set(loan.parts.map(part => part.mimeType))], coverMimeType };
  } catch {
    // Never emit a provider exception, URL, credential, header, or raw response.
    return evidence;
  } finally {
    runtime?.leases.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runLiveProbe();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.success ? 0 : 1;
}
