/**
 * Keyword policy for spotting life events in calendar items. Pure: takes the
 * lifelog day map and returns suggestions for the user to confirm. It is the
 * judge whenever no typed-decision model is configured, and the baseline the
 * model is shadow-compared against (see LifeEventSuggester).
 */
import { LifeEventType } from '../value-objects/LifeEventType.mjs';

/** Signal kind → LifeEvent.type. The kind is kept as the event's subtype. */
export const LIFE_EVENT_SIGNAL_KINDS = Object.freeze({
  relocation: LifeEventType.LOCATION,
  job_change: LifeEventType.CAREER,
  health_event: LifeEventType.HEALTH,
  family_event: LifeEventType.FAMILY,
  education: LifeEventType.EDUCATION,
  financial: LifeEventType.FINANCIAL,
});

// Order matters: the first matching pattern wins, so education comes before
// job_change ("First day of school" is education, not a job start).
// Keywords are phrases that mark a lasting change; routine lookalikes are
// deliberately absent: anniversaries (yearly), bare "exam" (eye/physical
// exams), bare "hospital" (volunteer shifts, visits), bare "birth" (birth
// certificates), doctor follow-ups.
const DEFAULT_PATTERNS = [
  { kind: 'relocation', keywords: ['moving day', 'new apartment', 'house closing'], confidence: 0.8 },
  { kind: 'education', keywords: ['graduation', 'orientation', 'first day of school', 'first day of class', 'first class', 'final exam', 'final exams', 'bar exam'], confidence: 0.7 },
  { kind: 'job_change', keywords: ['first day at', 'last day at work', 'onboarding', 'resignation'], confidence: 0.7 },
  { kind: 'health_event', keywords: ['surgery', 'hospital stay', 'admitted to hospital', 'hospitalized', 'diagnosis'], confidence: 0.8 },
  { kind: 'family_event', keywords: ['wedding', 'birth of', 'baby born', 'funeral'], confidence: 0.9 },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compile = (patterns) => patterns.map((p) => ({
  ...p,
  re: new RegExp(`\\b(?:${p.keywords.map(escapeRe).join('|')})\\b`, 'i'),
}));

/** Calendar items for one lifelog day, whichever shape the aggregator produced. */
export function calendarItemsForDay(day) {
  const data = day?.sources?.calendar || day?.categories?.calendar?.calendar;
  if (!data) return [];
  return Array.isArray(data) ? data : (data.events || []);
}

/** A suggestion in LifeEvent terms: type from the kind, kind kept as subtype. */
export function toSuggestion(date, item, kind, confidence, detector) {
  return {
    date,
    type: LIFE_EVENT_SIGNAL_KINDS[kind],
    subtype: kind,
    name: item.summary || item.name,
    source: 'calendar',
    confidence,
    detector,
  };
}

export class LifeEventSignalDetector {
  #patterns;

  constructor(config = {}) {
    this.#patterns = compile(config.patterns || DEFAULT_PATTERNS);
  }

  /** First matching pattern for one calendar item, or null. */
  classify(item) {
    const summary = item?.summary || item?.name || '';
    if (!summary) return null;
    const hit = this.#patterns.find((p) => p.re.test(summary));
    return hit ? { kind: hit.kind, confidence: hit.confidence ?? 0.7 } : null;
  }

  detectFromLifelog(lifelogDays) {
    const out = [];
    for (const [date, day] of Object.entries(lifelogDays || {})) {
      for (const item of calendarItemsForDay(day)) {
        const hit = this.classify(item);
        if (hit) out.push(toSuggestion(date, item, hit.kind, hit.confidence, 'keyword'));
      }
    }
    return out;
  }
}
