// frontend/src/modules/Health/CoachChat/mentions/suggestMetrics.js
export async function suggestMetrics({ prefix = '' } = {}) {
  const u = new URL('/api/v1/health/mentions/metrics', window.location.origin);
  if (prefix) u.searchParams.set('prefix', prefix);
  try {
    const res = await fetch(u.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  } catch {
    return [];
  }
}
