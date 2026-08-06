/**
 * Teacher console URL model: /school/teacher/<tab>[/<learnerId>].
 * The tab and the selected learner are the whole navigation state, so a
 * phone home-screen shortcut deep-links to one child's tab directly.
 * An unknown tab normalizes to Today rather than erroring — a stale
 * bookmark should land somewhere useful, never on a broken view.
 */
export const TEACHER_BASE = '/school/teacher';
export const TABS = ['today', 'planning', 'records', 'repair'];

export function parseTeacherPath(pathname) {
  const rest = String(pathname ?? '').startsWith(TEACHER_BASE)
    ? pathname.slice(TEACHER_BASE.length)
    : '';
  const seg = rest.split('/').filter(Boolean).map(decodeURIComponent);
  if (!seg.length || !TABS.includes(seg[0])) return { tab: 'today', learnerId: null };
  return { tab: seg[0], learnerId: seg[1] ?? null };
}

export function teacherPathFor(tab, learnerId = null) {
  const safeTab = TABS.includes(tab) ? tab : 'today';
  return learnerId
    ? `${TEACHER_BASE}/${safeTab}/${encodeURIComponent(learnerId)}`
    : `${TEACHER_BASE}/${safeTab}`;
}
