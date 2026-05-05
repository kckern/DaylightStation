// frontend/src/modules/Health/CoachChat/mentions/suggestRecentDays.js
export async function suggestRecentDays({ prefix = '', userId, has = null, days = 30 } = {}) {
  if (!userId) return [];
  const u = new URL('/api/v1/health/mentions/recent-days', window.location.origin);
  u.searchParams.set('user', userId);
  u.searchParams.set('days', String(days));
  if (has) u.searchParams.set('has', has);
  try {
    const res = await fetch(u.toString());
    if (!res.ok) return [];
    const data = await res.json();
    let out = data.suggestions || [];
    if (prefix) {
      const p = prefix.toLowerCase();
      out = out.filter(s => s.slug.toLowerCase().includes(p));
    }
    return out;
  } catch {
    return [];
  }
}
