/**
 * Admin Scheduler Router
 *
 * CRUD API for managing cron jobs defined in system/config/jobs.yml
 * with runtime state from system/state/cron-runtime.yml.
 *
 * Endpoints (all under /api/v1/admin/scheduler):
 * - GET    /jobs          - List all jobs merged with runtime state
 * - POST   /jobs          - Create a new job
 * - GET    /jobs/:id      - Get single job detail with runtime state
 * - PUT    /jobs/:id      - Update job fields (cannot change id)
 * - DELETE /jobs/:id      - Remove a job
 * - POST   /jobs/:id/run  - Trigger immediate execution (placeholder)
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Create Admin Scheduler Router
 *
 * @param {Object} config
 * @param {Object} config.configService - ConfigService for data directory paths
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminSchedulerRouter(config) {
  const { configService, logger = console } = config;
  const router = express.Router();

  /**
   * Get the resolved data root directory
   */
  function getDataRoot() {
    return path.resolve(configService.getDataDir());
  }

  /**
   * Read the jobs array from system/config/jobs.yml
   * @returns {Array<Object>} Array of job definitions
   */
  function readJobsFile() {
    const absPath = path.join(getDataRoot(), 'system/config/jobs.yml');
    if (!fs.existsSync(absPath)) return [];
    const raw = fs.readFileSync(absPath, 'utf8');
    return yaml.load(raw) || [];
  }

  /**
   * Write the jobs array to system/config/jobs.yml
   * @param {Array<Object>} jobs - Array of job definitions
   */
  function writeJobsFile(jobs) {
    const absPath = path.join(getDataRoot(), 'system/config/jobs.yml');
    // Ensure parent directory exists
    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const content = yaml.dump(jobs, { indent: 2, lineWidth: -1, noRefs: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }

  /**
   * Read the runtime state map from system/state/cron-runtime.yml
   * @returns {Object} Map of jobId → runtime state
   */
  function readRuntimeState() {
    const absPath = path.join(getDataRoot(), 'system/state/cron-runtime.yml');
    if (!fs.existsSync(absPath)) return {};
    const raw = fs.readFileSync(absPath, 'utf8');
    return yaml.load(raw) || {};
  }

  // ===========================================================================
  // GET /jobs - List all jobs merged with runtime state
  // ===========================================================================

  router.get('/jobs', (req, res) => {
    try {
      const jobs = readJobsFile();
      const runtime = readRuntimeState();
      const merged = jobs.map(job => ({
        ...job,
        runtime: runtime[job.id] || null,
      }));
      logger.info?.('admin.scheduler.jobs.listed', { count: merged.length });
      res.json({ jobs: merged });
    } catch (error) {
      logger.error?.('admin.scheduler.jobs.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list jobs' });
    }
  });

  // ===========================================================================
  // POST /jobs - Create a new job
  // ===========================================================================

  router.post('/jobs', (req, res) => {
    try {
      const { id, name, module, schedule, dependencies, window } = req.body || {};

      // Validate required fields
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Field "id" is required and must be a string' });
      }
      if (/\s/.test(id)) {
        return res.status(400).json({ error: 'Field "id" must not contain spaces' });
      }
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Field "name" is required and must be a string' });
      }
      if (!schedule || typeof schedule !== 'string') {
        return res.status(400).json({ error: 'Field "schedule" is required and must be a string (cron expression)' });
      }

      const jobs = readJobsFile();

      // Check for duplicate id
      if (jobs.some(job => job.id === id)) {
        return res.status(409).json({ error: `Job with id "${id}" already exists` });
      }

      // Build the new job object
      const newJob = { id, name };
      if (module !== undefined) newJob.module = module;
      newJob.schedule = schedule;
      if (dependencies !== undefined) newJob.dependencies = dependencies;
      if (window !== undefined) newJob.window = window;

      jobs.push(newJob);
      writeJobsFile(jobs);

      logger.info?.('admin.scheduler.job.created', { id, name });
      res.status(201).json({ ok: true, job: newJob });
    } catch (error) {
      logger.error?.('admin.scheduler.job.create.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to create job' });
    }
  });

  // ===========================================================================
  // GET /jobs/:id - Get single job detail with runtime state
  // ===========================================================================

  router.get('/jobs/:id', (req, res) => {
    try {
      const jobId = req.params.id;
      const jobs = readJobsFile();
      const job = jobs.find(j => j.id === jobId);

      if (!job) {
        return res.status(404).json({ error: `Job "${jobId}" not found` });
      }

      const runtime = readRuntimeState();
      const merged = {
        ...job,
        runtime: runtime[jobId] || null,
      };

      logger.info?.('admin.scheduler.job.read', { id: jobId });
      res.json({ job: merged });
    } catch (error) {
      logger.error?.('admin.scheduler.job.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read job' });
    }
  });

  // ===========================================================================
  // PUT /jobs/:id - Update job fields (cannot change id)
  // ===========================================================================

  router.put('/jobs/:id', (req, res) => {
    try {
      const jobId = req.params.id;
      const jobs = readJobsFile();
      const index = jobs.findIndex(j => j.id === jobId);

      if (index === -1) {
        return res.status(404).json({ error: `Job "${jobId}" not found` });
      }

      const { name, module, schedule, dependencies, window } = req.body || {};

      // Merge allowed fields into the existing job
      if (name !== undefined) jobs[index].name = name;
      if (module !== undefined) jobs[index].module = module;
      if (schedule !== undefined) jobs[index].schedule = schedule;
      if (dependencies !== undefined) jobs[index].dependencies = dependencies;
      if (window !== undefined) jobs[index].window = window;

      writeJobsFile(jobs);

      logger.info?.('admin.scheduler.job.updated', { id: jobId });
      res.json({ ok: true, job: jobs[index] });
    } catch (error) {
      logger.error?.('admin.scheduler.job.update.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to update job' });
    }
  });

  // ===========================================================================
  // DELETE /jobs/:id - Remove a job
  // ===========================================================================

  router.delete('/jobs/:id', (req, res) => {
    try {
      const jobId = req.params.id;
      const jobs = readJobsFile();
      const index = jobs.findIndex(j => j.id === jobId);

      if (index === -1) {
        return res.status(404).json({ error: `Job "${jobId}" not found` });
      }

      jobs.splice(index, 1);
      writeJobsFile(jobs);

      logger.info?.('admin.scheduler.job.deleted', { id: jobId });
      res.json({ ok: true, id: jobId });
    } catch (error) {
      logger.error?.('admin.scheduler.job.delete.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to delete job' });
    }
  });

  // ===========================================================================
  // POST /jobs/:id/run - Trigger immediate job execution (placeholder)
  // ===========================================================================

  router.post('/jobs/:id/run', (req, res) => {
    const jobId = req.params.id;
    logger.info?.('admin.scheduler.job.run.requested', { id: jobId });
    res.status(202).json({ ok: true, message: 'Job queued for execution' });
  });

  return router;
}

export default createAdminSchedulerRouter;
