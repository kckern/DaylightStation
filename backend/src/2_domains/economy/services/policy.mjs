// policy.mjs — pure functions over the economy.yml config shape. No I/O.
export function resolvePolicy(config, userId, action) {
  const base = config?.earn?.[action] || config?.spend?.[action] || null;
  if (!base) return null;
  const override = config?.users?.[userId]?.[action] || {};
  const type = config?.earn?.[action] ? 'earn' : 'spend';
  return { type, action, ...base, ...override };
}

// windows: ["HH:MM-HH:MM", ...]; overnight ranges (start > end) wrap midnight.
export function inBlackout(windows, now = new Date()) {
  if (!Array.isArray(windows) || windows.length === 0) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return windows.some((w) => {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(w).trim());
    if (!m) return false;
    const start = +m[1] * 60 + +m[2];
    const end = +m[3] * 60 + +m[4];
    return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
  });
}

// per: "<N>min" (e.g. "10min"); returns coins/second.
export function drainPerSecond({ cost, per }) {
  const m = /^(\d+)min$/.exec(String(per || '').trim());
  if (!m || !cost) return 0;
  return cost / (+m[1] * 60);
}
