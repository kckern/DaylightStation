import { describe, it, expect } from 'vitest';
import express from 'express';
import { createSchoolRouter } from './school.mjs';

function appWith(schoolService) {
  const app = express();
  app.use('/api/v1/school', createSchoolRouter({ schoolService, logger: { error() {} } }));
  return app;
}

it('GET /geography/decks returns the deck summaries', async () => {
  const schoolService = { listDeckSummaries: () => [
    { deckId: 'world-flags', bankId: 'geo:world-flags', title: 'World Flags', itemType: 'asset_choice', available: true }] };
  const app = appWith(schoolService);
  const { default: request } = await import('supertest');
  const res = await request(app).get('/api/v1/school/geography/decks');
  expect(res.status).toBe(200);
  expect(res.body.decks[0].deckId).toBe('world-flags');
});
