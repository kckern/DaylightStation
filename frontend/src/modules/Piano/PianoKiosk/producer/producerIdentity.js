let fallbackCounter = 0;

/**
 * Mint a session-independent take id. Producer used to restart at `take-1` on
 * every mount, so unrelated recordings could alias during persistence.
 */
export function mintTakeId(prefix = 'take') {
  const safePrefix = String(prefix).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'take';
  if (globalThis.crypto?.randomUUID) return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const words = new Uint32Array(4);
    globalThis.crypto.getRandomValues(words);
    return `${safePrefix}-${[...words].map((n) => n.toString(16).padStart(8, '0')).join('')}`;
  }
  // Last-resort compatibility for old WebViews. Timestamp + process-local
  // counter + 53 bits of randomness is still materially safer than a resettable
  // sequence, while modern production runtimes take one of the crypto paths.
  fallbackCounter += 1;
  return `${safePrefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

/** Stable musical-content digest used to make persisting one take idempotent. */
export async function takeContentHash(take, kind = take?.kind) {
  const payload = stable({
    kind: kind ?? 'idea',
    notes: Array.isArray(take?.notes) ? take.notes : [],
    ppq: take?.ppq ?? 480,
    lengthBars: take?.lengthBars ?? null,
    drumMode: !!take?.drumMode,
    timeline: take?.timeline ?? null,
  });
  const serialized = JSON.stringify(payload);
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(serialized);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  // Local-network kiosk pages are not always treated as secure contexts by
  // older Android WebViews, so crypto.subtle can be absent even though the app
  // itself works. Persisting a recorded take must not fail at the finish line.
  // crypto-js is already a frontend dependency; load only this small fallback
  // chunk, and keep the exact SHA-256 wire identity used by the backend.
  const { default: sha256 } = await import('crypto-js/sha256.js');
  return sha256(serialized).toString();
}
