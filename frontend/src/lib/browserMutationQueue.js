import { subscribeToStorageKey } from './browserPreference.js';

// Each queue retains its legacy array format. Enqueue is synchronous so a
// caller can acknowledge a durable write before changing its UI.
const MAX_PENDING_OPERATIONS = 500;

export function createBrowserMutationQueue({ prefix, getOwner, idOf, valid = () => true }) {
  const flushing = new Map();
  const acknowledged = new Map();

  function read(owner) {
    const raw = localStorage.getItem(prefix + owner);
    const rows = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('Invalid offline queue.');
    return rows.filter(valid);
  }

  function snapshot(owner = getOwner()) {
    if (!owner || owner !== getOwner()) return [];
    try { return read(owner); }
    catch { return []; }
  }

  function subscribe(owner, listener) {
    return subscribeToStorageKey(prefix + owner, () => {
      if (owner && owner === getOwner()) listener(snapshot(owner));
    });
  }

  function enqueue(owner, operation) {
    if (!owner || owner !== getOwner()) throw new Error('Offline account unavailable.');
    const rows = read(owner);
    if (rows.length >= MAX_PENDING_OPERATIONS) throw new Error('The offline queue is full.');
    rows.push(operation);
    localStorage.setItem(prefix + owner, JSON.stringify(rows));
    return rows;
  }

  async function flush(owner, send, { onDequeue, onError } = {}) {
    if (!owner || owner !== getOwner()) return 0;
    if (flushing.has(owner)) return flushing.get(owner);
    let completed = 0;
    let operation;
    const drain = async () => {
      while (getOwner() === owner) {
        [operation] = read(owner);
        if (!operation) break;
        const id = idOf(operation);
        let receipt = acknowledged.get(owner);
        if (!receipt || receipt.id !== id) {
          receipt = { id, result: await send(operation) };
          acknowledged.set(owner, receipt);
        }
        if (getOwner() !== owner) break;
        const remaining = read(owner).filter(row => idOf(row) !== id);
        localStorage.setItem(prefix + owner, JSON.stringify(remaining));
        acknowledged.delete(owner);
        completed++;
        onDequeue?.(remaining, operation, receipt.result);
      }
    };
    const replay = async () => {
      try {
        const locks = globalThis.navigator?.locks;
        if (locks?.request) {
          // A contending tab can still see the old storage snapshot immediately
          // after the holder releases. Leave this flush to the current holder.
          await locks.request(prefix + owner, { ifAvailable: true }, lock => lock && drain());
        } else {
          await drain();
        }
      } catch (error) { onError?.(error, operation); }
      return completed;
    };
    const promise = replay();
    flushing.set(owner, promise);
    try { return await promise; }
    finally { flushing.delete(owner); }
  }

  return { enqueue, snapshot, subscribe, flush };
}
