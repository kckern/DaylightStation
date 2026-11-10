/**
 * Which of the family's daily household gems are lit (spec 2026-10-24), from
 * each kid's facts for one study day. Pure and deterministic: nothing here
 * reads a clock or a file; the caller gathers the facts and the day's awards.
 *
 * A kid's facts: { learnerId, away, school, rings, read }
 *   school  'met' | 'missed' | 'excused' (no school work today) | 'unknown'
 *   rings   number, or null when the ring source is unreadable
 *   read    true | false, or null when the reading source is unreadable
 *
 * An away kid is excused from every gem; a school-excused kid from emerald only.
 *
 * A gem's state is one of:
 *   lit      every non-excused kid meets the rule (or, for an awarded gem, it was awarded)
 *   dim      someone falls short (`waitingOn` names them), or every kid is excused —
 *            a gem never lights for free
 *   unknown  a non-excused kid's source is unreadable — never shown as lit or missed
 */
export const GEM_KINDS = Object.freeze(['all-day-met', 'all-rings', 'all-read', 'awarded']);
export const GEM_COLORS = Object.freeze({ emerald: '#2e9e5b', amethyst: '#8e5bd0', sapphire: '#1e88e5', ruby: '#d6304a' });
export const DEFAULT_GEM_RULES = Object.freeze({
  gems: [
    { id: 'emerald', label: 'Schoolwork', kind: 'all-day-met' },
    { id: 'amethyst', label: 'Exercise', kind: 'all-rings', at: 250 },
    { id: 'sapphire', label: 'Reading', kind: 'all-read' },
    { id: 'ruby', label: "Parent's pick", kind: 'awarded' },
  ],
});

/** The gem rules in config order, defaults filled in; entries of an unknown kind are dropped. */
export function normalizeGemRules(doc) {
  const list = Array.isArray(doc?.gems) ? doc.gems : DEFAULT_GEM_RULES.gems;
  return list
    .filter((g) => typeof g?.id === 'string' && GEM_KINDS.includes(g.kind))
    .map((g) => ({
      id: g.id, kind: g.kind, label: typeof g.label === 'string' ? g.label : g.id,
      color: typeof g.color === 'string' ? g.color : (GEM_COLORS[g.id] ?? '#888888'),
      ...(g.kind === 'all-rings' ? { at: Number.isFinite(g.at) && g.at > 0 ? g.at : 250 } : {}),
    }));
}

// A kid's verdict on one rule gem: 'met' | 'missed' | 'excused' | 'unknown'.
// For emerald the school status is the verdict, so 'excused' (no work today) excuses there only.
function verdict(rule, f) {
  if (f.away) return 'excused';
  if (rule.kind === 'all-day-met') return f.school ?? 'unknown';
  if (rule.kind === 'all-rings') return f.rings == null ? 'unknown' : (f.rings >= rule.at ? 'met' : 'missed');
  if (rule.kind === 'all-read') return f.read == null ? 'unknown' : (f.read ? 'met' : 'missed');
  return 'unknown';
}

/** Each rule's gem for the day: { id, label, color, kind, state, waitingOn }. */
export function evaluateHouseholdGems(rules, facts, { awarded = new Set() } = {}) {
  const gems = rules.map((rule) => {
    const base = { id: rule.id, label: rule.label, color: rule.color, kind: rule.kind };
    if (rule.kind === 'awarded') return { ...base, state: awarded.has(rule.id) ? 'lit' : 'dim', waitingOn: [] };
    const verdicts = facts.map((f) => ({ learnerId: f.learnerId, v: verdict(rule, f) }));
    const counted = verdicts.filter((x) => x.v !== 'excused');
    if (counted.some((x) => x.v === 'unknown')) {
      return { ...base, state: 'unknown', waitingOn: counted.filter((x) => x.v === 'unknown').map((x) => x.learnerId) };
    }
    if (!counted.length) return { ...base, state: 'dim', waitingOn: [] };
    const waitingOn = counted.filter((x) => x.v !== 'met').map((x) => x.learnerId);
    return { ...base, state: waitingOn.length ? 'dim' : 'lit', waitingOn };
  });
  return { gems };
}
