import moment from 'moment-timezone';
import { PERIOD_KINDS, deepFreeze, fail, instant, optionalInstant, requireNonEmpty } from '../support.mjs';

export class PeriodRef {
  constructor({ kind, id, startsAt, endsAt = null }) {
    if (!PERIOD_KINDS.includes(kind)) fail('Unsupported period kind', 'UNSUPPORTED_PERIOD_KIND', 'kind', { kind });
    this.kind = kind;
    this.id = requireNonEmpty(id, 'period.id', 'INVALID_PERIOD_ID');
    this.startsAt = instant(startsAt, 'period.startsAt');
    this.endsAt = optionalInstant(endsAt, 'period.endsAt');
    if (this.endsAt != null && this.endsAt <= this.startsAt) {
      fail('period.endsAt must be after startsAt', 'INVALID_PERIOD_RANGE', 'period.endsAt');
    }
    deepFreeze(this);
  }

  equals(other) {
    return this.kind === other?.kind && this.id === other?.id
      && this.startsAt === other?.startsAt && this.endsAt === (other?.endsAt ?? null);
  }

  static localDay(id, timezone) {
    if (!moment.tz.zone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(id)) fail('Invalid local day', 'INVALID_LOCAL_DAY', 'period.id');
    const start = moment.tz(id, 'YYYY-MM-DD', true, timezone);
    if (!start.isValid() || start.format('YYYY-MM-DD') !== id) fail('Invalid local day', 'INVALID_LOCAL_DAY', 'period.id');
    return new PeriodRef({ kind: 'local_day', id, startsAt: start.valueOf(), endsAt: start.clone().add(1, 'day').valueOf() });
  }

  static localWeek(id, timezone) {
    if (!moment.tz.zone(timezone) || !/^\d{4}-W\d{2}$/.test(id)) fail('Invalid local week', 'INVALID_LOCAL_WEEK', 'period.id');
    const start = moment.tz(id, 'GGGG-[W]WW', true, timezone).startOf('isoWeek');
    if (!start.isValid() || start.format('GGGG-[W]WW') !== id) fail('Invalid local week', 'INVALID_LOCAL_WEEK', 'period.id');
    return new PeriodRef({ kind: 'local_week', id, startsAt: start.valueOf(), endsAt: start.clone().add(1, 'week').valueOf() });
  }
}

export default PeriodRef;
