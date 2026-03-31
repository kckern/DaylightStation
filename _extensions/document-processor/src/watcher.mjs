import chokidar from 'chokidar';
import { processInbox } from './processor.mjs';
import { createServer, setStatus } from './server.mjs';

const INBOX = '/data/_Inbox';
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || '15000', 10);
const STALE_MS = parseInt(process.env.STALE_BATCH_MS || '300000', 10);

let debounceTimer = null;
let staleTimer = null;
let processing = false;

async function triggerProcess() {
  if (processing) {
    console.log('Already processing, skipping trigger');
    return;
  }
  processing = true;
  setStatus({ state: 'processing' });

  try {
    const result = await processInbox(console.log);
    setStatus({ state: 'idle', lastRun: new Date().toISOString(), lastResult: result });
  } catch (err) {
    console.error('Processing failed:', err.message);
    setStatus({ state: 'error', lastResult: { error: err.message } });
  } finally {
    processing = false;
  }
}

function resetDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    console.log(`No new files for ${DEBOUNCE_MS / 1000}s — processing batch`);
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
    triggerProcess();
  }, DEBOUNCE_MS);

  if (!staleTimer) {
    staleTimer = setTimeout(() => {
      console.log(`Stale batch timeout (${STALE_MS / 1000}s) — forcing process`);
      if (debounceTimer) clearTimeout(debounceTimer);
      staleTimer = null;
      triggerProcess();
    }, STALE_MS);
  }
}

console.log(`Watching ${INBOX} for JPGs (debounce: ${DEBOUNCE_MS}ms)`);

chokidar.watch(INBOX, {
  ignored: /(^|[/\\])\../,
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
})
  .on('add', (path) => {
    if (!/\.jpe?g$/i.test(path)) return;
    console.log(`New page: ${path.split('/').pop()}`);
    resetDebounce();
  });

createServer();
