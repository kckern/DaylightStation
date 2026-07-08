/**
 * Admin Scheduler Router (thin HTTP shell)
 *
 * CRUD API for cron jobs. All persistence + rules (jobs.yml I/O, runtime-state
 * merge, id validation, manual-run delegation) live in SchedulerAdminService
 * (#apps/admin/SchedulerAdminService.mjs), injected from the composition root.
 * This router only extracts params, calls the service, and shapes the HTTP
 * response. Typed errors propagate to the P1.3 string error-middleware
 * (ValidationError→400, NotFoundError→404, ConflictError→409).
 *
 * Endpoints (all under /api/v1/admin/scheduler):
 * - GET    /jobs          - List all jobs merged with runtime state
 * - POST   /jobs          - Create a new job
 * - GET    /jobs/:id      - Get single job detail with runtime state
 * - PUT    /jobs/:id      - Update job fields (cannot change id)
 * - DELETE /jobs/:id      - Remove a job
 * - POST   /jobs/:id/run  - Trigger immediate execution via the real scheduler
 *                           (501 Not Implemented if no orchestrator is wired)
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Create Admin Scheduler Router
 *
 * @param {Object} config
 * @param {Object} config.schedulerAdminService - Injected SchedulerAdminService (from the composition root)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminSchedulerRouter(config) {
  const { schedulerAdminService: service, logger = console } = config;
  if (!service) {
    throw new Error('createAdminSchedulerRouter requires an injected schedulerAdminService');
  }
  const router = express.Router();

  // GET /jobs - List all jobs merged with runtime state
  router.get('/jobs', asyncHandler((req, res) => {
    res.json(service.listJobs());
  }));

  // POST /jobs - Create a new job
  router.post('/jobs', asyncHandler((req, res) => {
    const { job } = service.createJob(req.body || {});
    res.status(201).json({ ok: true, job });
  }));

  // GET /jobs/:id - Get single job detail with runtime state
  router.get('/jobs/:id', asyncHandler((req, res) => {
    res.json(service.getJob(req.params.id));
  }));

  // PUT /jobs/:id - Update job fields (cannot change id)
  router.put('/jobs/:id', asyncHandler((req, res) => {
    const { job } = service.updateJob(req.params.id, req.body || {});
    res.json({ ok: true, job });
  }));

  // DELETE /jobs/:id - Remove a job
  router.delete('/jobs/:id', asyncHandler((req, res) => {
    const { id } = service.deleteJob(req.params.id);
    res.json({ ok: true, id });
  }));

  // POST /jobs/:id/run - Trigger immediate job execution via the real scheduler
  router.post('/jobs/:id/run', asyncHandler(async (req, res) => {
    const result = await service.runJob(req.params.id);
    res.status(202).json({ ok: true, ...result });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createAdminSchedulerRouter;
