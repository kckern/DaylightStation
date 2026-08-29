import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHomeAutomationRouter } from './homeAutomation.mjs';
import { EventAggregationService } from '#apps/home/EventAggregationService.mjs';

const homeAutomationService = {
  getStatus: () => ({}),
};

function subject(events) {
  const eventAggregationService = new EventAggregationService({
    eventRepository: {
      defaultUsername: () => 'learner',
      loadUpcomingEvents: () => events,
    },
    logger: { warn() {} },
  });
  const app = express();
  app.use('/home', createHomeAutomationRouter({ homeAutomationService, eventAggregationService, logger: { info() {} } }));
  return app;
}

describe('home agenda HTTP contract', () => {
  it('preserves the todo widget envelope while application code owns cleanup and clipping', async () => {
    const response = await request(subject([
      { type: 'todoist', summary: '[Read the chapter](https://example.test)   tonight' },
    ])).get('/home/todos?limit=1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [{ text: 'Read the chapter tonight', done: false }] });
  });

  it('preserves the 503 envelope when agenda operations are unwired', async () => {
    const app = express();
    app.use('/home', createHomeAutomationRouter({ homeAutomationService }));
    const response = await request(app).get('/home/calendar');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Event aggregation not configured' });
  });
});
