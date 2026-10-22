// Buzzer bindings outlive a page refresh: keyed by session, cleared at results.
const key = (sessionId) => `party-games:buzzers:${sessionId}`;

export function saveBuzzerBindings(sessionId, bindings) {
  if (!sessionId || !bindings) return;
  try { window.localStorage.setItem(key(sessionId), JSON.stringify(bindings)); } catch { /* refresh loses bindings; phone fallback remains */ }
}
export function loadBuzzerBindings(sessionId) {
  if (!sessionId) return null;
  try { const raw = window.localStorage.getItem(key(sessionId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function forgetBuzzerBindings(sessionId) {
  if (!sessionId) return;
  try { window.localStorage.removeItem(key(sessionId)); } catch { /* nothing to forget */ }
}
