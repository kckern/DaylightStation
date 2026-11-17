import { schoolApi } from '../schoolApi.js';

const KEY = 'school.mount-ack.v1';
const LIMIT = 8;
let pending = [];
let timer = null;
let flushing = null;
const live = item => typeof item.receipt === 'string' && item.receipt.length <= 4096 && Number.isFinite(item.expiresAt) && item.expiresAt > Date.now();
function save() {
  pending = pending.filter(live).slice(-LIMIT);
  try { sessionStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* memory retries still work */ }
}
function schedule() {
  if (timer) clearTimeout(timer);
  timer = pending.some(live) ? setTimeout(() => { timer = null; void flushMountAcknowledgements(); }, 3000) : null;
}
/** Receipts are opaque. No grants, access codes or learner data enter this queue. */
export function rememberMount({ mountReceipt, mountExpiresAt }) {
  const item = { receipt: mountReceipt, mounted: null, expiresAt: Date.parse(mountExpiresAt) };
  if (!live(item)) return false;
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
    if (Array.isArray(stored)) for (const item of stored.filter(live).slice(-LIMIT)) {
      if (!pending.some(entry => entry.receipt === item.receipt)) pending.push({ ...item, mounted: item.mounted === true });
    }
  } catch { /* an unreadable queue carries no settlement authority */ }
  save(); void flushMountAcknowledgements();
}
export function flushMountAcknowledgements() {
  if (flushing) return flushing.then(() => pending.some(item => live(item) && typeof item.mounted === 'boolean') ? flushMountAcknowledgements() : undefined);
  flushing = (async () => {
    for (const item of [...pending].filter(item => live(item) && typeof item.mounted === 'boolean')) {
      try {
        const result = await schoolApi.selfServiceMountAck({ receipt: item.receipt, mounted: item.mounted });
        // Definitive server refusal or success finishes this attempt; transport errors retry.
        if (result?.ok && typeof result.data?.ok === 'boolean') pending = pending.filter(entry => entry !== item);
      } catch { /* preserve for retry; do not log receipts */ }
    }
    save();
  })().finally(() => { flushing = null; schedule(); });
  return flushing;
}
