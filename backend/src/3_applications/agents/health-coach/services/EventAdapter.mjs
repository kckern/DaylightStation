// backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs

/**
 * EventAdapter — domain-agnostic interface for the health coach.
 *
 * Each implementation wraps a domain service (fitness, nutrition, weight) and
 * surfaces three primitives:
 *
 *   list({ period, filter, limit }) → { events: EventRow[], meta }
 *   detail(id) → EventDetail | { error }
 *   summary({ period }) → DomainSummary
 *
 * EventRow shape (consistent across kinds):
 *   {
 *     kind: 'workout' | 'meal' | 'weigh_in',
 *     id: string,                    // primary key for detail()
 *     timestamp: string,             // ISO
 *     date: string,                  // YYYY-MM-DD
 *     label: string,                 // human-readable ("28 min Run", "Lunch — 480 kcal", "175.2 lbs")
 *     scalars: object,               // domain metric snapshot (kcal, hr_avg, weight_lbs, etc.)
 *     vs_baseline?: object,          // attached by Task 10
 *     domain_extras: object,         // domain-specific fields (strava_id, items[], etc.)
 *   }
 *
 * EventDetail shape — pass-through of the domain object PLUS coach-friendly
 * structured summaries. See per-adapter docs.
 */
export class EventAdapter {
  /** @param {{ period, filter?, limit? }} args */
  async list(args) { throw new Error('EventAdapter.list not implemented'); }
  /** @param {string} id */
  async detail(id) { throw new Error('EventAdapter.detail not implemented'); }
  /** @param {{ period }} args */
  async summary(args) { throw new Error('EventAdapter.summary not implemented'); }
}

export const EVENT_KINDS = Object.freeze(['workout', 'meal', 'weigh_in']);
