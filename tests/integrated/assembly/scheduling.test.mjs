/**
 * Scheduling Integration Tests
 *
 * Tests the scheduling router endpoints with mocked stores.
 * Verifies job listing, status retrieval, and manual job triggering.
 */

import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { SchedulerService } from '#domains/scheduling/services/SchedulerService.mjs';
import { createSchedulingRouter } from '#backend/src/4_api/v1/routers/scheduling.mjs';
import { Job } from '#domains/scheduling/entities/Job.mjs';
import { JobState } from '#domains/scheduling/entities/JobState.mjs';

describe('scheduling integration', () => {
  let app;
  let schedulerService;
  let mockJobStore;
  let mockStateStore;
  let mockScheduler;
  let mockLogger;

  const testJobs = [
    new Job({
      id: 'test-job-1',
      name: 'Test Job 1',
      module: '/fake/module1.mjs',
      schedule: '0 * * * *',
      enabled: true,
      bucket: 'cronHourly'
    }),
    new Job({
      id: 'test-job-2',
      name: 'Test Job 2',
      module: '/fake/module2.mjs',
      schedule: '0 0 * * *',
      enabled: true,
      bucket: 'cronDaily'
    }),
    new Job({
      id: 'disabled-job',
      name: 'Disabled Job',
      module: '/fake/disabled.mjs',
      schedule: '*/10 * * * *',
      enabled: false,
      bucket: 'cron10Mins'
    })
  ];

  const testStates = new Map([
    ['test-job-1', new JobState({
      jobId: 'test-job-1',
      lastRun: '2026-01-13 10:00:00',
      nextRun: '2026-01-13 11:00:00',
      status: 'success',
      durationMs: 1500
    })],
    ['test-job-2', new JobState({
      jobId: 'test-job-2',
      lastRun: '2026-01-13 00:00:00',
      nextRun: '2026-01-14 00:00:00',
      status: 'success',
      durationMs: 2500
    })]
  ]);

  beforeAll(() => {
    // Create mock job store
    mockJobStore = {
      loadJobs: jest.fn().mockResolvedValue(testJobs),
      getJob: jest.fn().mockImplementation(async (jobId) => {
        return testJobs.find(j => j.id === jobId) || null;
      }),
      getAllJobs: jest.fn().mockResolvedValue(testJobs)
    };

    // Create mock state store
    mockStateStore = {
      loadStates: jest.fn().mockResolvedValue(testStates),
      getJobState: jest.fn().mockImplementation(async (jobId) => {
        return testStates.get(jobId) || new JobState({ jobId });
      }),
      saveState: jest.fn().mockResolvedValue(undefined),
      backup: jest.fn().mockResolvedValue(undefined)
    };

    // Create mock scheduler (the cron scheduler)
    mockScheduler = {
      getStatus: jest.fn().mockReturnValue({
        enabled: true,
        running: true,
        tickIntervalMs: 60000
      })
    };

    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      })
    };

    // Create scheduler service with mocked stores
    schedulerService = new SchedulerService({
      jobStore: mockJobStore,
      stateStore: mockStateStore,
      timezone: 'America/Los_Angeles',
      logger: mockLogger
    });

    // Create Express app with scheduling router
    app = express();
    app.use(express.json());
    app.use('/scheduling', createSchedulingRouter({
      schedulerService,
      scheduler: mockScheduler,
      logger: mockLogger
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /scheduling/jobs', () => {
    it('should return list of all jobs', async () => {
      const res = await request(app).get('/scheduling/jobs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('jobs');
      expect(Array.isArray(res.body.jobs)).toBe(true);
      expect(res.body.count).toBe(3);
    });

    it('should include job details in response', async () => {
      const res = await request(app).get('/scheduling/jobs');

      const job1 = res.body.jobs.find(j => j.id === 'test-job-1');
      expect(job1).toBeDefined();
      expect(job1.name).toBe('Test Job 1');
      expect(job1.schedule).toBe('0 * * * *');
      expect(job1.enabled).toBe(true);
      expect(job1.bucket).toBe('cronHourly');
    });

    it('should include disabled jobs', async () => {
      const res = await request(app).get('/scheduling/jobs');

      const disabledJob = res.body.jobs.find(j => j.id === 'disabled-job');
      expect(disabledJob).toBeDefined();
      expect(disabledJob.enabled).toBe(false);
    });
  });

  describe('GET /scheduling/status', () => {
    it('should return status with all jobs', async () => {
      const res = await request(app).get('/scheduling/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('jobs');
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });

    it('should include scheduler status', async () => {
      const res = await request(app).get('/scheduling/status');

      expect(res.body).toHaveProperty('scheduler');
      expect(res.body.scheduler.enabled).toBe(true);
      expect(res.body.scheduler.running).toBe(true);
    });

    it('should include job state information', async () => {
      const res = await request(app).get('/scheduling/status');

      const job1Status = res.body.jobs.find(j => j.id === 'test-job-1');
      expect(job1Status).toBeDefined();
      expect(job1Status).toHaveProperty('lastRun');
      expect(job1Status).toHaveProperty('nextRun');
      expect(job1Status).toHaveProperty('status');
      expect(job1Status).toHaveProperty('durationMs');
      expect(job1Status.status).toBe('success');
    });

    it('should include running job count', async () => {
      const res = await request(app).get('/scheduling/status');

      expect(res.body).toHaveProperty('runningCount');
      expect(typeof res.body.runningCount).toBe('number');
    });
  });

  describe('GET /scheduling/running', () => {
    it('should return list of running jobs', async () => {
      const res = await request(app).get('/scheduling/running');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('jobs');
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });

    it('should return empty list when no jobs running', async () => {
      const res = await request(app).get('/scheduling/running');

      expect(res.body.count).toBe(0);
      expect(res.body.jobs).toHaveLength(0);
    });
  });

  describe('POST /scheduling/run/:jobId', () => {
    it('should return 404 for non-existent job', async () => {
      const res = await request(app).post('/scheduling/run/non-existent-job');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('should attempt to trigger existing job', async () => {
      // The job will fail to execute because the module doesn't exist,
      // but this tests that the router correctly calls the service
      const res = await request(app).post('/scheduling/run/test-job-1');

      // The job will fail because the module path is fake
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('jobId', 'test-job-1');
      expect(res.body).toHaveProperty('executionId');
      expect(res.body).toHaveProperty('status');
    });
  });

  describe('bucket endpoints', () => {
    it('GET /scheduling/cron10Mins should respond with execution info', async () => {
      const res = await request(app).get('/scheduling/cron10Mins');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('time');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('executionId');
      expect(res.body.message).toContain('cron10Mins');
    });

    it('GET /scheduling/cronHourly should respond with execution info', async () => {
      const res = await request(app).get('/scheduling/cronHourly');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('time');
      expect(res.body.message).toContain('cronHourly');
    });

    it('GET /scheduling/cronDaily should respond with execution info', async () => {
      const res = await request(app).get('/scheduling/cronDaily');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('time');
      expect(res.body.message).toContain('cronDaily');
    });

    it('GET /scheduling/cronWeekly should respond with execution info', async () => {
      const res = await request(app).get('/scheduling/cronWeekly');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('time');
      expect(res.body.message).toContain('cronWeekly');
    });
  });

  describe('error handling', () => {
    it('should handle store errors gracefully for /status', async () => {
      mockJobStore.loadJobs.mockRejectedValueOnce(new Error('Store unavailable'));

      const res = await request(app).get('/scheduling/status');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });

    it('should handle store errors gracefully for /jobs', async () => {
      mockJobStore.loadJobs.mockRejectedValueOnce(new Error('Store unavailable'));

      const res = await request(app).get('/scheduling/jobs');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});
