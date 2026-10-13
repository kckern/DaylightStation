// frontend/src/modules/Health/CoachChat/mentions/suggestPeriods.js
export async function suggestPeriods({ prefix = '', userId } = {}) {
  if (!userId) return [];
  const u = new URL('/api/v1/health/mentions/periods', window.location.origin);
  u.searchParams.set('user', userId);
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
