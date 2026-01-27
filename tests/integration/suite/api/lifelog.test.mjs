// tests/integration/api/lifelog.test.mjs
/**
 * Lifelog API Integration Tests
 *
 * Tests the lifelog router integration with a mock aggregator.
 * Verifies that the router correctly handles requests and delegates to the aggregator.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createLifelogRouter } from '#backend/src/4_api/v1/routers/lifelog.mjs';

describe('lifelog integration', () => {
  let app;
  let mockAggregator;

  beforeAll(() => {
    // Create a mock aggregator that follows the LifelogAggregator interface
    mockAggregator = {
      extractors: [
        { source: 'garmin', category: 'health' },
        { source: 'strava', category: 'fitness' },
        { source: 'calendar', category: 'calendar' },
      ],

      getAvailableSources() {
        return this.extractors.map((e) => e.source);
      },

      async aggregate(username, date) {
        // Return a mock aggregated result
        return {
          date,
          sources: {
            garmin: { steps: 10000, heartRate: { resting: 55 } },
            strava: { activities: [{ type: 'Run', distance: 5000 }] },
          },
          summaries: [
            { source: 'garmin', category: 'health', text: '10,000 steps' },
            { source: 'strava', category: 'fitness', text: '5K run' },
          ],
          categories: {
            health: { garmin: { steps: 10000 } },
            fitness: { strava: { activities: [] } },
          },
          summaryText: '10,000 steps\n\n5K run',
          _meta: {
            username,
            date,
            availableSourceCount: 2,
            hasEnoughData: true,
            sources: ['garmin', 'strava'],
            categories: ['health', 'fitness'],
          },
        };
      },
    };

    app = express();
    app.use(express.json());
    app.use('/lifelog', createLifelogRouter({ aggregator: mockAggregator }));
  });

  // ===========================================================================
  // SOURCES ENDPOINT
  // ===========================================================================
  describe('GET /lifelog/sources', () => {
    it('should return sources list', async () => {
      const res = await request(app).get('/lifelog/sources');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sources)).toBe(true);
    });

    it('should return configured extractor sources', async () => {
      const res = await request(app).get('/lifelog/sources');

      expect(res.status).toBe(200);
      expect(res.body.sources).toContain('garmin');
      expect(res.body.sources).toContain('strava');
      expect(res.body.sources).toContain('calendar');
    });
  });

  // ===========================================================================
  // AGGREGATE ENDPOINT
  // ===========================================================================
  describe('GET /lifelog/aggregate/:username/:date', () => {
    it('should return aggregated data for valid request', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/2024-01-15');

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2024-01-15');
      expect(res.body._meta.username).toBe('testuser');
    });

    it('should include sources in response', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/2024-01-15');

      expect(res.status).toBe(200);
      expect(res.body.sources).toBeDefined();
      expect(res.body.sources.garmin).toBeDefined();
      expect(res.body.sources.strava).toBeDefined();
    });

    it('should include summaries in response', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/2024-01-15');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.summaries)).toBe(true);
      expect(res.body.summaries.length).toBeGreaterThan(0);
    });

    it('should include meta information', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/2024-01-15');

      expect(res.status).toBe(200);
      expect(res.body._meta).toBeDefined();
      expect(res.body._meta.hasEnoughData).toBe(true);
      expect(res.body._meta.sources).toContain('garmin');
    });

    it('should return 400 for invalid date format', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/invalid-date');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date');
    });

    it('should return 400 for malformed date', async () => {
      const res = await request(app).get('/lifelog/aggregate/testuser/2024-13-45');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date');
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================
  describe('error handling', () => {
    it('should handle aggregator errors gracefully', async () => {
      // Create a separate app with a failing aggregator
      const failingAggregator = {
        getAvailableSources() {
          return [];
        },
        async aggregate() {
          throw new Error('Aggregation failed');
        },
      };

      const errorApp = express();
      errorApp.use(express.json());
      errorApp.use('/lifelog', createLifelogRouter({ aggregator: failingAggregator }));

      const res = await request(errorApp).get('/lifelog/aggregate/testuser/2024-01-15');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Aggregation failed');
    });

    it('should handle missing getAvailableSources method', async () => {
      // Create aggregator without getAvailableSources
      const minimalAggregator = {
        async aggregate() {
          return { date: '2024-01-15', sources: {} };
        },
      };

      const minimalApp = express();
      minimalApp.use(express.json());
      minimalApp.use('/lifelog', createLifelogRouter({ aggregator: minimalAggregator }));

      const res = await request(minimalApp).get('/lifelog/sources');

      expect(res.status).toBe(200);
      expect(res.body.sources).toEqual([]);
    });
  });
});
