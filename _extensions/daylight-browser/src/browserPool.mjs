import { failure, safeFailure } from './operationRegistry.mjs';

// Owns only browser lifetime, ephemeral contexts, deadline, and concurrency.
export function createBrowserPool({ launch, timeoutMs = 30_000, cleanupTimeoutMs = 1_000 }) {
  let browser;
  let launching;
  let busy = false;
  let stopped = false;
  let cancelActive;
  const browserClosures = new WeakMap();
  async function boundedClose(close) {
    let timeout;
    try {
      await Promise.race([
        Promise.resolve().then(close),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(failure('BROWSER_TIMEOUT')), cleanupTimeoutMs); }),
      ]);
      return true;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  }
  function closeBrowser(value) {
    if (!value) return Promise.resolve();
    if (!browserClosures.has(value)) browserClosures.set(value, Promise.resolve().then(() => value.close()));
    return browserClosures.get(value);
  }
  async function stopBrowser() {
    stopped = true;
    // Bound the entire acquisition-and-close chain. The continuation stays
    // attached after this deadline and disposes any browser that arrives late.
    await boundedClose(async () => closeBrowser(browser ?? await launching));
    browser = null;
  }
  async function getBrowser() {
    if (!browser) {
      launching ??= Promise.resolve().then(launch).then(async value => {
        if (stopped) { await closeBrowser(value); return null; }
        browser = value;
        return value;
      });
      try { return await launching; }
      finally { launching = null; }
    }
    return browser;
  }
  return Object.freeze({
    async run(operation, { signal } = {}) {
      if (stopped) throw failure('BROWSER_FAILED');
      if (signal?.aborted) throw failure('BROWSER_CANCELLED');
      if (busy) throw failure('BROWSER_BUSY');
      busy = true;
      let context;
      let closing;
      let finished = false;
      let cancellationCode;
      let timer;
      const operationAbort = new AbortController();
      const closeContext = () => {
        if (context) closing ??= (async () => {
          if (!await boundedClose(() => context.close())) {
            // Never reuse a browser whose context could still hold request state.
            await stopBrowser();
          }
        })();
        return closing;
      };
      let cancel;
      const cancelled = new Promise((_, reject) => {
        cancel = code => {
          if (cancellationCode) return;
          cancellationCode = code;
          finished = true;
          operationAbort.abort();
          // Acquisitions cannot be cancelled by Playwright. Poison this pool
          // before releasing ownership; no subsequent call can overlap one.
          if (!context) stopped = true;
          closeContext();
          reject(failure(code));
        };
        timer = setTimeout(() => cancel('BROWSER_TIMEOUT'), timeoutMs);
      });
      const onAbort = () => cancel('BROWSER_CANCELLED');
      cancelActive = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      const acquisition = (async () => {
        const activeBrowser = await getBrowser();
        if (finished || stopped || !activeBrowser) return;
        context = await activeBrowser.newContext({ acceptDownloads: false, serviceWorkers: 'block', permissions: [] });
        if (finished) { await closeContext(); return; }
      })();
      const work = acquisition.then(() => {
        if (!finished && context) return operation(context, { signal: operationAbort.signal });
      });
      try { return await Promise.race([work, cancelled]); }
      catch (error) {
        if (browser?.isConnected && !browser.isConnected()) browser = null;
        throw safeFailure(error);
      } finally {
        finished = true;
        operationAbort.abort();
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        // Retain ownership until operation work has observed cancellation and
        // the context is closed. A worker that ignores abort poisons the pool,
        // so no later operation can overlap its external work.
        if (!await boundedClose(async () => {
          await acquisition;
          await Promise.allSettled([work, closeContext()]);
        })) stopped = true;
        if (stopped) await stopBrowser();
        busy = false;
        cancelActive = null;
      }
    },
    async close() {
      stopped = true;
      cancelActive?.();
      await stopBrowser();
    },
  });
}
