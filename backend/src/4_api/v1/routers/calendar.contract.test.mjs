import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCalendarRouter } from './calendar.mjs';
import { CalendarReadContext } from '#apps/calendar/CalendarReadContext.mjs';

function subject(events) {
  const calendarReadContext = new CalendarReadContext({
    householdContext: { resolve: (id) => id || 'home', timezone: () => 'America/Los_Angeles' },
    loadEvents: () => events,
    logger: { warn() {} },
  });
  const app = express();
  app.use('/calendar', createCalendarRouter({ calendarReadContext }));
  return app;
}

describe('calendar HTTP contract', () => {
  const events = [{
    id: 'all-day', summary: 'Holiday', start: { date: '2026-08-28' }, end: { date: '2026-08-29' },
    organizer: { displayName: 'Family' },
  }, {
    id: 'timed', summary: 'Dentist', start: { dateTime: '2026-08-28T14:30:00-07:00' },
    end: { dateTime: '2026-08-28T15:00:00-07:00' },
  }];

  it('preserves the dated response envelope and all-day-first ordering', async () => {
    const response = await request(subject(events)).get('/calendar/events/2026-08-28?household=h1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'success', date: '2026-08-28', count: 2, _household: 'h1',
      events: [
        expect.objectContaining({ id: 'all-day', allDay: true, time: null, calendar: 'Family' }),
        expect.objectContaining({ id: 'timed', allDay: false, time: '2:30 PM' }),
      ],
    });
  });

  it('preserves the invalid-date 400 envelope', async () => {
    const response = await request(subject(events)).get('/calendar/events/08-28-2026');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: 'error', error: 'Invalid date format. Use YYYY-MM-DD.' });
  });
});
