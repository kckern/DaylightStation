/**
 * Days off panel — pure draft logic (no React, no I/O).
 *
 * The panel edits the household calendar whole: every break, past ones
 * included, travels back on save so the server can prove no settled day
 * changed. A past break is carried VERBATIM (its original span); only today
 * and later are shaped by the editor.
 */
export const TIERS = ['normal', 'stay-home', 'enrichment', 'major-holiday', 'away'];
export const ACTIVITY_TIERS = ['enrichment', 'major-holiday'];

export const TIER_LABELS = {
  normal: 'School day',
  'stay-home': 'Stay home',
  enrichment: 'Enrichment',
  'major-holiday': 'Holiday',
  away: 'Away',
};

let keySeq = 0;
const nextKey = () => `brk-${++keySeq}`;

/** `holiday-<slug>` from a break's label. */
export function activityIdFor(label) {
  const slug = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `holiday-${slug || 'activity'}`;
}

/**
 * 'past' (ended before today), 'started' (began before today, so some of its
 * days are already judged), or 'open' (nothing judged yet, today included).
 */
export function breakLock(brk, today) {
  if (brk.to && brk.to < today) return 'past';
  if (brk.from && brk.from < today) return 'started';
  return 'open';
}

/** Upcoming sorted by start; past newest first. */
export function splitBreaks(breaks, today) {
  const upcoming = breaks.filter((b) => breakLock(b, today) !== 'past')
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const past = breaks.filter((b) => breakLock(b, today) === 'past')
    .sort((a, b) => String(b.from).localeCompare(String(a.from)));
  return { upcoming, past };
}

/** The editable draft from `GET /calendar`. */
export function draftFromServer(data) {
  const today = data?.today ?? '';
  return {
    baseRevision: data?.revision ?? null,
    today,
    keepLists: data?.dayOffTiers ?? null,
    keepListsTouched: false,
    breaks: (data?.except ?? []).map((span) => {
      const activity = span.assignment ? data?.activities?.[span.assignment] ?? null : null;
      return {
        key: nextKey(),
        from: span.from ?? '', to: span.to ?? '', label: span.label ?? '', tier: span.tier ?? 'away',
        replaces: span.replaces ?? '', assignment: span.assignment ?? '',
        activity: activity
          ? { title: activity.title ?? '', instructions: activity.instructions ?? '', editable: activity.editable !== false, touched: false }
          : null,
        orig: span,
        lock: breakLock(span, today),
        isNew: false,
        assignTo: [],
      };
    }),
  };
}

/** A new away trip. */
export function awayTrip({ from, to, label }) {
  return {
    key: nextKey(), from, to: to || from, label: String(label ?? '').trim() || 'Away', tier: 'away',
    replaces: '', assignment: '', activity: null, orig: null, lock: 'open', isNew: true, assignTo: [],
  };
}

/** A new blank break. */
export function blankBreak(today) {
  return {
    key: nextKey(), from: today, to: today, label: '', tier: 'stay-home',
    replaces: '', assignment: '', activity: null, orig: null, lock: 'open', isNew: true, assignTo: [],
  };
}

/** The friendly first problem with the draft, or null. */
export function validateDraft(draft) {
  for (const brk of draft.breaks) {
    if (brk.lock === 'past') continue;
    const name = brk.label?.trim() ? `"${brk.label.trim()}"` : 'A break';
    if (!brk.label?.trim()) return 'Every break needs a name.';
    if (!brk.from || !brk.to) return `${name} needs both dates.`;
    if (brk.to < brk.from) return `${name} ends before it starts.`;
    if (!TIERS.includes(brk.tier)) return `${name} needs a kind of day.`;
    if (brk.tier === 'enrichment' && !brk.replaces) return `${name} is an enrichment day — pick the subject it replaces.`;
    if (ACTIVITY_TIERS.includes(brk.tier) && brk.activity?.editable !== false && !brk.activity?.title?.trim()) {
      return `Give ${name}'s activity a title.`;
    }
  }
  return null;
}

/** `PUT /calendar` body (without the teacher stamp, which `useTeacherWrite` adds). */
export function payloadFromDraft(draft) {
  const activities = new Map();
  const assignTo = new Set();
  const except = draft.breaks.map((brk) => {
    if (brk.lock === 'past' && brk.orig) return brk.orig;
    const span = { from: brk.from, to: brk.to, label: brk.label.trim(), tier: brk.tier };
    if (brk.tier === 'enrichment' && brk.replaces) span.replaces = brk.replaces;
    if (ACTIVITY_TIERS.includes(brk.tier)) {
      span.assignment = brk.assignment || activityIdFor(brk.label);
      if (brk.activity && brk.activity.editable !== false && !activities.has(span.assignment)) {
        activities.set(span.assignment, {
          unitId: span.assignment, title: brk.activity.title.trim(), instructions: (brk.activity.instructions ?? '').trim(),
        });
      }
      if (!brk.assignment) (brk.assignTo ?? []).forEach((id) => assignTo.add(id));
    }
    return span;
  });
  return {
    except,
    dayOffTiers: draft.keepLists ?? null,
    activities: [...activities.values()],
    assignTo: [...assignTo],
    baseRevision: draft.baseRevision,
  };
}
