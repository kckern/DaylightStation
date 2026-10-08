const STORAGE_KEY = 'fitness.ended-device-hold.v1';
const PERSIST_TOUCH_INTERVAL_MS = 60_000;

function defaultStorage() {
  try { return globalThis.localStorage ?? null; }
  catch (_) { return null; }
}

function nextLocalDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

export class EndedDeviceHold {
  constructor({ storage = defaultStorage(), now = () => Date.now(), storageKey = STORAGE_KEY } = {}) {
    this.storage = storage;
    this.now = now;
    this.storageKey = storageKey;
    this.devices = new Map();
    this.expiresAt = null;
    this._lastPersistAt = 0;
    this._restore();
  }

  hold(deviceIds, timestamp = this.now()) {
    this._expire(timestamp);
    for (const rawId of deviceIds || []) {
      const id = String(rawId || '');
      if (id) this.devices.set(id, { lastSeenAt: timestamp });
    }
    if (this.devices.size) this.expiresAt = nextLocalDay(timestamp);
    this._persist(timestamp);
  }

  // Returns true when the packet may continue through normal ingestion.
  filter(rawDeviceId, timestamp = this.now()) {
    this._expire(timestamp);
    const id = String(rawDeviceId || '');
    const held = id ? this.devices.get(id) : null;
    if (!held) return true;

    held.lastSeenAt = timestamp;
    if (timestamp - this._lastPersistAt >= PERSIST_TOUCH_INTERVAL_MS) this._persist(timestamp);
    return false;
  }

  observeAbsence(activeDeviceIds, removeMs, timestamp = this.now()) {
    this._expire(timestamp);
    const active = new Set(Array.from(activeDeviceIds || [], (id) => String(id)));
    let changed = false;
    for (const [id, state] of this.devices) {
      if (active.has(id)) state.lastSeenAt = timestamp;
      if (!active.has(id) && timestamp - state.lastSeenAt >= removeMs) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed || active.size) this._persist(timestamp);
  }

  _expire(timestamp) {
    if (this.expiresAt != null && timestamp >= this.expiresAt) {
      this.devices.clear();
      this.expiresAt = null;
      this._persist(timestamp);
    }
  }

  _restore() {
    if (!this.storage) return;
    try {
      const parsed = JSON.parse(this.storage.getItem(this.storageKey) || 'null');
      if (!parsed || !Array.isArray(parsed.devices)) return;
      this.expiresAt = Number(parsed.expiresAt) || null;
      for (const entry of parsed.devices) {
        const id = String(entry?.id || '');
        const lastSeenAt = Number(entry?.lastSeenAt);
        if (id && Number.isFinite(lastSeenAt)) this.devices.set(id, { lastSeenAt });
      }
      this._expire(this.now());
    } catch (_) {
      this.devices.clear();
      this.expiresAt = null;
    }
  }

  _persist(timestamp = this.now()) {
    this._lastPersistAt = timestamp;
    if (!this.storage) return;
    try {
      if (!this.devices.size) {
        this.storage.removeItem(this.storageKey);
        return;
      }
      this.storage.setItem(this.storageKey, JSON.stringify({
        expiresAt: this.expiresAt,
        devices: [...this.devices].map(([id, state]) => ({ id, lastSeenAt: state.lastSeenAt })),
      }));
    } catch (_) { /* storage is best-effort; the in-memory hold remains authoritative */ }
  }
}

export default EndedDeviceHold;
