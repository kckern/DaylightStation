import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CalendarReadSkill } from '../../../../../src/3_applications/concierge/skills/CalendarReadSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeCal {
  constructor() { this.calls = []; }
  async getEvents(opts) {
    this.calls.push(opts);
    return [{ id: '1', title: 'Mtg', startIso: opts.rangeFrom, endIso: opts.rangeTo, calendar: 'work' }];
  }
}

describe('CalendarReadSkill', () => {
  it('throws without ICalendarRead', () => {
    assert.throws(() => new CalendarReadSkill({ calendar: {} }), /ICalendarRead/);
  });

  it('exposes get_calendar_events', () => {
    const s = new CalendarReadSkill({ calendar: new FakeCal(), logger: silentLogger });
    assert.deepStrictEqual(s.getTools().map((t) => t.name), ['get_calendar_events']);
  });

  it('defaults range to next 7 days', async () => {
    const cal = new FakeCal();
    const s = new CalendarReadSkill({ calendar: cal, logger: silentLogger });
    const tool = s.getTools()[0];
    const r = await tool.execute({}, {});
    assert.strictEqual(r.events.length, 1);
    assert.ok(cal.calls[0].rangeFrom);
    assert.ok(cal.calls[0].rangeTo);
  });
});
