import moment from 'moment-timezone';

const VALID_SCOPES = ['week', 'month', 'season', 'year', 'decade'];
const SCOPE_DAYS = { week: 7, month: 30, season: 90, year: 365, decade: 3650 };

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function scopeRange(scope, at) {
  if (at && /^\d{4}-\d{2}$/.test(at)) {
    const start = moment(at, 'YYYY-MM').startOf('month');
    return { start: start.format('YYYY-MM-DD'), end: start.clone().endOf('month').format('YYYY-MM-DD') };
  }
  if (at && /^\d{4}$/.test(at)) {
    const start = moment(at, 'YYYY').startOf('year');
    return { start: start.format('YYYY-MM-DD'), end: start.clone().endOf('year').format('YYYY-MM-DD') };
  }
  const end = moment();
  return { start: end.clone().subtract((SCOPE_DAYS[scope] || 30) - 1, 'days').format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

export class LifeApiOperations {
  constructor({ aggregator = null, userDirectory = null, listHouseholdUsers = null,
    defaultUsername = 'default', lifePlanOperations = null } = {}) {
    this.aggregator = aggregator;
    this.userDirectory = userDirectory;
    this.listUsers = listHouseholdUsers;
    this.defaultUsername = defaultUsername || 'default';
    this.lifePlanOperations = lifePlanOperations;
  }

  resolveUsername(explicit) { return explicit || this.defaultUsername; }
  isKnownUser(username) { return this.userDirectory?.getProfile ? Boolean(this.userDirectory.getProfile(username)) : true; }
  user(username) {
    const profile = this.userDirectory?.getProfile?.(username);
    return { username, displayName: profile?.display_name || username };
  }
  roster() { return (this.listUsers?.() || []).map((username) => this.user(username)); }
  health(username) {
    const checks = this.lifePlanOperations.healthChecks(username);
    const ok = checks.plan?.loaded !== false && Object.values(checks.services).every(Boolean);
    return { status: ok ? 'ok' : 'degraded', checks };
  }

  sources() { return this.aggregator?.getAvailableSources?.() || []; }
  day(username, date) {
    if (!validDate(date)) return { kind: 'invalid_date' };
    return this.aggregator.aggregate(username, date).then((value) => ({ kind: 'found', value }));
  }
  range(username, start, end) {
    if (!start || !end || !validDate(start) || !validDate(end)) return { kind: 'invalid_range' };
    return this.aggregator.aggregateRange(username, start, end).then((value) => ({ kind: 'found', value }));
  }
  scope(username, scope, at) {
    if (!VALID_SCOPES.includes(scope)) return { kind: 'invalid_scope', validScopes: VALID_SCOPES };
    const { start, end } = scopeRange(scope, at);
    return this.aggregator.aggregateRange(username, start, end).then((value) => ({ kind: 'found', value, start, end }));
  }
  async category(username, category, { start, end, scope } = {}) {
    let rangeStart; let rangeEnd;
    if (start && end) [rangeStart, rangeEnd] = [start, end];
    else ({ start: rangeStart, end: rangeEnd } = scopeRange(VALID_SCOPES.includes(scope) ? scope : 'month'));
    const result = await this.aggregator.aggregateRange(username, rangeStart, rangeEnd);
    const filtered = { ...result, days: {} };
    for (const [date, day] of Object.entries(result.days)) {
      const data = day.categories?.[category];
      if (data && Object.keys(data).length) filtered.days[date] = {
        sources: data, categories: { [category]: data },
        summaries: day.summaries?.filter((summary) => summary.category === category) || [],
      };
    }
    return filtered;
  }
}

export default LifeApiOperations;
