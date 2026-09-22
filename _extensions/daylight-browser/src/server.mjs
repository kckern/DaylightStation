import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createBrowserPool } from './browserPool.mjs';
import { createOperationRegistry, failure, failureStatus, safeFailure } from './operationRegistry.mjs';
import { createLibbyOperation } from './operations/libby/bootstrapLoan.mjs';
import { DAYLIGHT_BROWSER_TIMEOUTS } from './timeouts.mjs';

// Standalone extension structured sink: caller data is never accepted as a log field.
const logOutcome = outcome => process.stdout.write(`${JSON.stringify(outcome)}\n`);

export function createRequestHandler({ registry, logger = logOutcome }) {
  return async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const closed = () => { if (!res.writableEnded) abort(); };
    req.on('aborted', abort);
    res.on('close', closed);
    let status = 200;
    let result;
    let code = 'BROWSER_OK';
    let operationId = null;
    try {
      if (req.url === '/health' && req.method === 'GET') result = { status: 'ok' };
      else {
        const match = /^\/v1\/operations\/([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)$/.exec(req.url);
        if (!match) throw failure('BROWSER_OPERATION_UNKNOWN');
        if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw failure('BROWSER_INVALID_REQUEST');
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += Buffer.byteLength(chunk);
          if (length > 65_536) throw failure('BROWSER_INVALID_REQUEST');
          chunks.push(Buffer.from(chunk));
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('BROWSER_INVALID_REQUEST'); }
        if (typeof registry.prepare === 'function') {
          const prepared = registry.prepare(match[1], input);
          operationId = prepared.operationId;
          result = await prepared.execute({ signal: controller.signal });
        } else {
          result = await registry.dispatch(match[1], input, { signal: controller.signal });
        }
      }
    } catch (error) {
      code = safeFailure(error).code;
      status = failureStatus[code];
      result = { error: { code } };
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', closed);
    }
    logger({ event: 'browser.operation', operationId, outcome: code, status });
    if (res.destroyed) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify(result));
  };
}

async function start() {
  const { chromium } = await import('playwright');
  const pool = createBrowserPool({ timeoutMs: DAYLIGHT_BROWSER_TIMEOUTS.operationMs,
    cleanupTimeoutMs: DAYLIGHT_BROWSER_TIMEOUTS.cleanupMs,
    launch: () => chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] }) });
  const registry = createOperationRegistry([createLibbyOperation(pool)]);
  const server = http.createServer({ requestTimeout: DAYLIGHT_BROWSER_TIMEOUTS.httpRequestMs,
    headersTimeout: 10_000, maxHeaderSize: 8192 }, createRequestHandler({ registry }));
  server.listen(3000, '0.0.0.0');
  const stop = () => { server.close(); pool.close().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(() => { logOutcome({ event: 'browser.start', outcome: 'BROWSER_FAILED' }); process.exitCode = 1; });
}
