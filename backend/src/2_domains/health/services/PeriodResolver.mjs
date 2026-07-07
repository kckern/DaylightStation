// backend/src/2_domains/health/services/PeriodResolver.mjs

/**
 * Resolves polymorphic period inputs into a concrete `{ from, to, label, source }`
 * tuple.
 *
 * Plan 1 handles (sync internally):
 *   { rolling: 'last_<N>d' | 'last_<N>y' | 'all_time' | 'prev_<N>d' | 'prev_<N>y' }
 *   { calendar: 'YYYY' | 'YYYY-MM' | 'YYYY-Qn' | 'this_week' | 'this_month'
 *               | 'this_quarter' | 'this_year' | 'last_quarter' | 'last_year' }
 *   { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * Plan 4 adds:
 *   { named: 'slug' } — async lookup across working memory + playbook
 *
 * `deduced` form throws with hint to call deduce_period() explicitly.
 */

import { ValidationError, DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const CALENDAR_NAMED = [
  'this_week', 'this_month', 'this_quarter', 'this_year',
  'last_quarter', 'last_year',
];

const AGENT_ID = 'health-coach';
const PERIOD_REMEMBERED_PREFIX = 'period.remembered.';
const PERIOD_DEDUCED_PREFIX    = 'period.deduced.';

export class PeriodResolver {
  /**
   * @param {object} [opts]
   * @param {() => Date} [opts.now] - injectable clock (defaults to new Date())
   * @param {object} [opts.playbookLoader] - { loadPlaybook(userId) } for named lookup
   * @param {object} [opts.workingMemoryAdapter] - { load(agentId, userId) } for named lookup
   */
  constructor({
    now = () => new Date(),
    playbookLoader = null,
    workingMemoryAdapter = null,
  } = {}) {
    this.now = now;
    this.playbookLoader = playbookLoader;
    this.workingMemoryAdapter = workingMemoryAdapter;
  }

  /**
   * Resolve a polymorphic period input to absolute date bounds.
   *
   * Sync forms (rolling/calendar/explicit) resolve immediately; named
   * periods do an async lookup across playbook + working memory.
   *
   * @param {object} input
   * @param {object} [ctx] - { userId } required for named-period lookup
   * @returns {Promise<{from: string, to: string, label: string, source: string}>}
   */
  async resolve(input, ctx = {}) {
    // String shorthand: 'last_30d' → { rolling: 'last_30d' };
    // '2024' / '2024-Q3' / 'this_year' → { calendar: <label> }.
    // Bare strings let the model pass simple labels without the object
    // wrapper. The prompt cheatsheet still teaches the canonical form.
    if (typeof input === 'string') {
      if (this.#isRollingLabel(input)) return this.#resolveRolling(input);
      if (this.#isCalendarLabel(input)) return this.#resolveCalendar(input);
      throw new ValidationError(`PeriodResolver: unknown period string "${input}"`, { code: 'UNKNOWN_PERIOD_STRING', field: 'period', value: input });
    }

    if (!input || typeof input !== 'object') {
      throw new ValidationError('PeriodResolver.resolve: input must be an object or recognized string label', { code: 'INVALID_PERIOD_INPUT', field: 'period', value: input });
    }
    if (typeof input.rolling === 'string') return this.#resolveRolling(input.rolling);
    if (typeof input.calendar === 'string') return this.#resolveCalendar(input.calendar);
    if (typeof input.from === 'string' && typeof input.to === 'string') {
      return { from: input.from, to: input.to, label: `${input.from}..${input.to}`, source: 'explicit' };
    }
    if (typeof input.named === 'string') {
      return this.#resolveNamed(input.named, ctx);
    }
    if (input.deduced) {
      throw new DomainInvariantError('deduced period inline resolution is not supported. Call deduce_period() first and pass the result as { from, to }.', { code: 'DEDUCED_INLINE_UNSUPPORTED' });
    }
    throw new ValidationError('PeriodResolver.resolve: unknown period input shape', { code: 'UNKNOWN_PERIOD_SHAPE', field: 'period', value: input });
  }

  #isRollingLabel(label) {
    if (label === 'all_time') return true;
    return /^(last|prev)_\d+[dy]$/.test(label);
  }

  #isCalendarLabel(label) {
    if (CALENDAR_NAMED.includes(label)) return true;
    if (/^\d{4}$/.test(label)) return true;          // YYYY
    if (/^\d{4}-\d{2}$/.test(label)) return true;     // YYYY-MM
    if (/^\d{4}-Q[1-4]$/.test(label)) return true;    // YYYY-Qn
    return false;
  }

  #today() {
    const d = this.now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  #fmt(date) {
    return date.toISOString().slice(0, 10);
  }

  #resolveRolling(label) {
    const today = this.#today();
    if (label === 'all_time') {
      return { from: '1900-01-01', to: this.#fmt(today), label, source: 'rolling' };
    }
    const m = /^(last|prev)_(\d+)([dy])$/.exec(label);
    if (!m) {
      throw new ValidationError(`PeriodResolver: unknown rolling label "${label}"`, { code: 'UNKNOWN_ROLLING_LABEL', field: 'label', value: label });
    }
    const [, kind, nStr, unit] = m;
    const n = parseInt(nStr, 10);
    const days = unit === 'y' ? n * 365 : n;
    const to = new Date(today);
    const from = new Date(today);
    if (kind === 'last') {
      from.setUTCDate(today.getUTCDate() - (days - 1));
    } else { // prev
      to.setUTCDate(today.getUTCDate() - days);
      from.setUTCDate(today.getUTCDate() - (days * 2 - 1));
    }
    return { from: this.#fmt(from), to: this.#fmt(to), label, source: 'rolling' };
  }

  #resolveCalendar(label) {
    const today = this.#today();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-11

    if (label === 'this_year') {
      return { from: `${year}-01-01`, to: `${year}-12-31`, label, source: 'calendar' };
    }
    if (label === 'last_year') {
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label, source: 'calendar' };
    }
    if (label === 'this_month') {
      const last = new Date(Date.UTC(year, month + 1, 0));
      return { from: `${year}-${String(month + 1).padStart(2, '0')}-01`, to: this.#fmt(last), label, source: 'calendar' };
    }
    if (label === 'this_quarter' || label === 'last_quarter') {
      const q = Math.floor(month / 3) + (label === 'last_quarter' ? 0 : 1);
      const refYear = label === 'last_quarter' ? (q === 0 ? year - 1 : year) : year;
      const qIdx = label === 'last_quarter' ? (q === 0 ? 3 : q - 1) : q - 1; // 0..3
      const startMonth = qIdx * 3;
      const endMonth = startMonth + 2;
      const last = new Date(Date.UTC(refYear, endMonth + 1, 0));
      return {
        from: `${refYear}-${String(startMonth + 1).padStart(2, '0')}-01`,
        to: this.#fmt(last),
        label,
        source: 'calendar',
      };
    }
    if (label === 'this_week') {
      // ISO week: Mon..Sun
      const dow = today.getUTCDay() || 7; // 1..7
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - (dow - 1));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      return { from: this.#fmt(monday), to: this.#fmt(sunday), label, source: 'calendar' };
    }

    // YYYY
    let m = /^(\d{4})$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      return { from: `${y}-01-01`, to: `${y}-12-31`, label, source: 'calendar' };
    }
    // YYYY-MM
    m = /^(\d{4})-(\d{2})$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const last = new Date(Date.UTC(y, mo, 0));
      return { from: `${y}-${String(mo).padStart(2, '0')}-01`, to: this.#fmt(last), label, source: 'calendar' };
    }
    // YYYY-Qn
    m = /^(\d{4})-Q([1-4])$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      const q = parseInt(m[2], 10);
      const startMonth = (q - 1) * 3;
      const last = new Date(Date.UTC(y, startMonth + 3, 0));
      return {
        from: `${y}-${String(startMonth + 1).padStart(2, '0')}-01`,
        to: this.#fmt(last),
        label,
        source: 'calendar',
      };
    }
    throw new ValidationError(`PeriodResolver: unknown calendar label "${label}"`, { code: 'UNKNOWN_CALENDAR_LABEL', field: 'label', value: label });
  }

  async #resolveNamed(slug, ctx) {
    if (!this.playbookLoader && !this.workingMemoryAdapter) {
      throw new DomainInvariantError('PeriodResolver: named period lookup requires playbookLoader or workingMemoryAdapter dep', { code: 'NAMED_PERIOD_LOOKUP_UNAVAILABLE' });
    }
    const userId = ctx?.userId;

    // 1) workingMemory.period.remembered.<slug>
    if (this.workingMemoryAdapter && userId) {
      const state = await this.workingMemoryAdapter.load(AGENT_ID, userId);
      const all = (typeof state?.getAll === 'function') ? state.getAll() : {};
      const remembered = all[`${PERIOD_REMEMBERED_PREFIX}${slug}`];
      if (remembered) {
        return {
          from: remembered.from, to: remembered.to,
          label: remembered.label ?? slug,
          source: 'named', subSource: 'remembered',
        };
      }
      // 2) workingMemory.period.deduced.<slug>
      const deduced = all[`${PERIOD_DEDUCED_PREFIX}${slug}`];
      if (deduced) {
        return {
          from: deduced.from, to: deduced.to,
          label: deduced.label ?? slug,
          source: 'named', subSource: 'deduced',
        };
      }
    }

    // 3) playbook.named_periods.<slug>
    if (this.playbookLoader && userId) {
      const playbook = await this.playbookLoader.loadPlaybook(userId);
      const period = playbook?.named_periods?.[slug];
      if (period) {
        return {
          from: formatYmd(period.from),
          to:   formatYmd(period.to),
          label: slug,
          source: 'named', subSource: 'declared',
        };
      }
    }

    throw new EntityNotFoundError('NamedPeriod', slug, { details: { code: 'NAMED_PERIOD_NOT_FOUND' } });
  }
}

function formatYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
