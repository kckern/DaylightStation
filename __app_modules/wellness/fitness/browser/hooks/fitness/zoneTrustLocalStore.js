/**
 * zoneTrustLocalStore — each rider's last trusted heart-rate reading, kept in
 * the kiosk's own browser storage so a page reload can vouch for a rider who
 * was already working out (ops:docs/superpowers/specs/2026-11-10-zone-trust-survives-reload-design.md).
 *
 * The session's `zone_trust` metadata only comes back when a reload RESUMES the
 * previous session, which needs content playing. A reload onto a menu starts a
 * fresh session, and without this every rider waited for a fresh Cool reading:
 * 2026-11-10, a rider mid-workout at ~150 bpm sat at NO ZONE for 68 minutes.
 *
 * Pure helpers plus a guarded storage handle. Storage that is missing or throws
 * means nothing is saved or restored, never an error.
 */

export const ZONE_TRUST_STORAGE_KEY = 'fitness.zoneTrust.v1';
/** A reload may vouch for a rider whose last trusted reading is at most this old. */
export const ZONE_TRUST_RELOAD_WINDOW_MS = 30 * 60 * 1000;
/** Saves are throttled to one per this interval while evidence keeps changing. */
export const ZONE_TRUST_SAVE_INTERVAL_MS = 5000;

const validEvidence = (e) => !!e && Number.isFinite(e.at) && Number.isFinite(e.heartRate);

/**
 * The entry to store: riders with real (never simulated) evidence.
 * @param {Array<{ userId: string, evidence: object|null }>} riders
 */
export function buildEntry(riders, savedAt) {
  const out = [];
  for (const r of riders || []) {
    if (!r?.userId || !validEvidence(r.evidence) || r.evidence.simulated) continue;
    const { deviceId = null, zoneId = null, heartRate, at } = r.evidence;
    out.push({ userId: String(r.userId), evidence: { deviceId: deviceId != null ? String(deviceId) : null, zoneId, heartRate, at } });
  }
  return { savedAt, riders: out };
}

/** Riders whose evidence is within the reload window, and those dropped as too old. */
export function filterFresh(entry, nowMs, windowMs = ZONE_TRUST_RELOAD_WINDOW_MS) {
  const fresh = [];
  const stale = [];
  for (const r of entry?.riders || []) {
    if (!r?.userId || !validEvidence(r.evidence)) continue;
    const ageMs = nowMs - r.evidence.at;
    (ageMs >= 0 && ageMs <= windowMs ? fresh : stale).push({ ...r, ageMs });
  }
  return { fresh, stale };
}

/** The newer of two evidence records for the same rider (either may be null). */
export function newestEvidence(a, b) {
  if (!validEvidence(a)) return validEvidence(b) ? b : null;
  if (!validEvidence(b)) return a;
  return b.at > a.at ? b : a;
}

/** The kiosk's localStorage, or null when the browser refuses it. */
export function browserZoneTrustStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** @returns {{ ok: true, entry: object|null } | { ok: false }} */
export function loadEntry(storage) {
  if (!storage) return { ok: false };
  try {
    const raw = storage.getItem(ZONE_TRUST_STORAGE_KEY);
    if (!raw) return { ok: true, entry: null };
    const entry = JSON.parse(raw);
    return { ok: true, entry: entry && Array.isArray(entry.riders) ? entry : null };
  } catch {
    return { ok: false };
  }
}

/** @returns {boolean} whether the write landed */
export function saveEntry(storage, entry) {
  if (!storage) return false;
  try {
    storage.setItem(ZONE_TRUST_STORAGE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}
