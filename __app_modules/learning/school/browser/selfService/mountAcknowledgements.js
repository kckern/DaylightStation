import { schoolApi } from '../schoolApi.js';

const KEY = 'school.mount-ack.v1';
const LIMIT = 8;
const RESERVATION_MS = 120_000;
const ATTEMPT_MS = 5_000;
let pending = [];
let timer = null;
let flushing = null;
const live = item => item.deadline > performance.now();
function restore(item) {
  if (!item || typeof item.receipt !== 'string' || !item.receipt || item.receipt.length > 4096 || !Number.isFinite(item.expiresAt)) return null;
  // Epoch is needed across reloads only. Clock corrections cannot change an
  // already accepted receipt's elapsed lifetime in this process.
  const remaining = Math.min(RESERVATION_MS, item.expiresAt - Date.now());
  return remaining > 0 ? { receipt: item.receipt, mounted: item.mounted, expiresAt: item.expiresAt, deadline: performance.now() + remaining } : null;
}
function save() {
  pending = pending.filter(live).slice(-LIMIT);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending.map(({ receipt, mounted, expiresAt }) => ({ receipt, mounted, expiresAt }))));
  } catch { /* memory retries still work */ }
}
function schedule() {
  if (timer) clearTimeout(timer);
  const remaining = pending.map(item => item.deadline - performance.now());
  timer = remaining.length ? setTimeout(() => {
    timer = null; save(); schedule(); void flushMountAcknowledgements();
  }, Math.max(0, Math.min(3000, ...remaining))) : null;
}
/** Only opaque receipts/results are retained, never copied program grants or codes. */
export function rememberMount({ mountReceipt, mountExpiresAt }) {
  const existing = pending.find(item => item.receipt === mountReceipt);
  if (existing) return live(existing);
  const item = restore({ receipt: mountReceipt, mounted: null, expiresAt: Date.parse(mountExpiresAt) });
  if (!item) return false;
  pending = pending.filter(entry => entry.receipt !== item.receipt);
  pending.push(item); save(); schedule();
  return true;
}
export function settleMount(receipt, mounted) {
  const item = pending.find(entry => entry.receipt === receipt);
  if (item) item.mounted = mounted === true;
  save();
  return flushMountAcknowledgements();
}
export function resumeMountAcknowledgements() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(stored)) for (const raw of stored.slice(-LIMIT)) {
      if (!pending.some(entry => entry.receipt === raw?.receipt)) {
        const item = restore(raw);
        if (item) pending.push({ ...item, mounted: item.mounted === true });
      }
    }
  } catch { /* an unreadable queue carries no settlement authority */ }
  save(); schedule(); void flushMountAcknowledgements();
}
async function attempt(item) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(null); }, Math.max(0, Math.min(ATTEMPT_MS, item.deadline - performance.now())));
  });
  try {
    // Promise.race also bounds non-cooperative transports; a late result has
    // no path to mutate the queue after the timed-out attempt has returned.
    return await Promise.race([
      schoolApi.selfServiceMountAck({ receipt: item.receipt, mounted: item.mounted }, { signal: controller.signal }), deadline,
    ]);
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
export function flushMountAcknowledgements() {
  if (flushing) return flushing;
  flushing = (async () => {
    const attempted = new Set();
    while (true) {
      // Include receipts queued during an earlier request, once per pass.
      const item = pending.find(item => live(item) && typeof item.mounted === 'boolean' && !attempted.has(item));
      if (!item) break;
      attempted.add(item);
      const result = await attempt(item);
      if (result?.ok && typeof result.data?.ok === 'boolean') pending = pending.filter(entry => entry !== item);
      save();
    }
  })().finally(() => { flushing = null; save(); schedule(); });
  return flushing;
}
