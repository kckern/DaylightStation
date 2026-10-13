import { ISchedulerTimestampCodec } from '#apps/scheduling/ports/ISchedulerTimestampCodec.mjs';

export class SchedulerTimestampCodec extends ISchedulerTimestampCodec {
  constructor({ timezone = 'America/Los_Angeles' } = {}) { super(); this.timezone = timezone; }
  format(date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  }
}
