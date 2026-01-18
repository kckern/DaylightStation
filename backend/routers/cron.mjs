"use strict";

import express from "express";
import crypto from "crypto";
import moment from "moment-timezone";
import { existsSync } from "fs";
import { CronExpressionParser } from "cron-parser";
import Infinity from "../lib/infinity.mjs";
import { loadFile, saveFile } from "../lib/io.mjs";
import { createLogger } from '../lib/logging/logger.js';
import { taskRegistry } from "../lib/cron/TaskRegistry.mjs";

// Only run cron jobs in production (Docker container)
const isDocker = existsSync('/.dockerenv');
const cronEnabled = isDocker || process.env.ENABLE_CRON === 'true';

const apiRouter = express.Router();
const timeZone = "America/Los_Angeles";

const cronLogger = createLogger({
  source: 'cron',
  app: 'scheduler',
  context: { env: process.env.NODE_ENV }
});

// Build legacy bucket-based mapping for endpoints and backward compatibility
// Note: Endpoints are created at startup; individual job schedules load dynamically in loadCronJobs
const cronRegistry = taskRegistry.load();
const cron = {
  cron10Mins: [],
  cronHourly: [],
  cronDaily: [],
  cronWeekly: []
};

// Map jobs from registry into buckets
taskRegistry.getJobs().forEach(job => {
  const bucket = job.bucket || (job.schedule.includes('*/10') ? 'cron10Mins' : 
                               job.schedule.includes('0 * * *') ? 'cronHourly' : 'cronDaily');
  if (cron[bucket]) {
    cron[bucket].push(job.module);
  } else {
    // If it's a new bucket name or individual job, we might eventually want individual endpoints
    cron[bucket] = [job.module];
  }
});

apiRouter.use((err, req, res, next) => {
  cronLogger.error('cron.middleware.error', { error: err?.message, stack: err?.stack });
  res.status(500).json({ error: err.message });
});

apiRouter.get('/status', (req, res) => {
  try {
    const jobsWithState = loadCronConfig();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      jobs: jobsWithState
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/run/:jobId', async (req, res) => {
  const { jobId } = req.params;
  try {
    const jobs = loadCronConfig();
    const job = jobs.find(j => j.id === jobId || j.name === jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const guidId = crypto.randomUUID().split("-").pop();
    cronLogger.info('cron.job.manual_trigger', { jobId, guidId });
    
    // Immediate response to client
    res.json({ status: 'started', jobId, guidId });

    // Execute in background
    const jobFile = job.module ? [job.module] : cron[job.name];
    if (jobFile) {
      for (const item of jobFile) {
        const module = await import(item);
        const fn = module.default;
        if (typeof fn === 'function') {
          await fn(cronLogger.child({ jobId: guidId, manual: true }), guidId);
        }
      }
    }
  } catch (err) {
    cronLogger.error('cron.job.manual_failed', { jobId, error: err.message });
  }
});

Object.keys(cron).forEach(key => {
  apiRouter.get(`/${key}`, async (req, res, next) => {
    try {
      const functions = [];
      for (const item of cron[key]) {
        if (typeof item === "string") {
          const module = await import(item);
          functions.push(module.default);
        } else if (typeof item === "function") {
          functions.push(item);
        } else {
          throw new Error(`Invalid item for ${key}`);
        }
      }
      
      const guidId = crypto.randomUUID().split("-").pop();
      cronLogger.info('cron.endpoint.called', { key, guidId });
      const data = {
        time: new Date().toISOString(),
        message: `Called endpoint for ${key}`,
        guidId
      };
      res.json(data);

      // Execute sequentially
      for (const fn of functions) {
        if (typeof fn === "function") {
          await fn(guidId);
        }
      }
    } catch (error) {
      next(error);
    }
  });
});

export default apiRouter;

function md5(string) {
  return crypto.createHash("md5").update(string).digest("hex");
}

function windowOffset(str) {
  const md5hash = md5(str);
  const numeric = parseInt(md5hash.replace(/[^0-9]/g, "").slice(-3)) || 0;
  const max = 999;
  return 0.5 - numeric / max;
}

function computeNextRun(job, fromMoment) {
  const cronTab = job.cron_tab || job.schedule;
  if (!cronTab) {
    throw new Error('Missing cron schedule');
  }
  const rawNext = CronExpressionParser.parse(cronTab, {
    currentDate: fromMoment.toDate(),
    tz: timeZone
  }).next().toDate();
  const offsetMinutes = job.window
    ? Math.round(windowOffset(rawNext.toString()) * parseFloat(job.window))
    : 0;
  return moment(rawNext).add(offsetMinutes, "minutes").tz(timeZone);
}

const legacyBuckets = new Set(['cron10Mins', 'cronHourly', 'cronDaily', 'cronWeekly']);

const inferBucketFromSchedule = (schedule) => {
  if (!schedule || typeof schedule !== 'string') {
    return null;
  }
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }
  const [minute, hour, , , dayOfWeek] = parts;
  if (minute.includes('*/10')) {
    return 'cron10Mins';
  }
  if (dayOfWeek && dayOfWeek !== '*' && dayOfWeek !== '?') {
    return 'cronWeekly';
  }
  if (hour === '*') {
    return 'cronHourly';
  }
  return 'cronDaily';
};

const migrateLegacyCronState = (legacyState, jobs) => {
  const migrated = {};
  if (!legacyState || typeof legacyState !== 'object' || !Array.isArray(jobs)) {
    return migrated;
  }
  for (const job of jobs) {
    const jobKey = job.id || job.name;
    const bucket = job.bucket || inferBucketFromSchedule(job.schedule || job.cron_tab);
    if (!bucket) {
      continue;
    }
    const legacy = legacyState[bucket];
    if (!legacy) {
      continue;
    }
    migrated[jobKey] = {
      last_run: legacy.last_run || null,
      nextRun: null,
      status: legacy.status || 'migrated',
      duration_ms: legacy.duration_ms || 0
    };
  }
  return migrated;
};

// Load job definitions from registry (uses cached jobs, not re-loading from disk)
const loadCronJobs = () => {
  const jobs = taskRegistry.getJobs();
  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    cronLogger.warn('cron.jobs.empty', { message: 'No cron jobs loaded from registry' });
    return [];
  }
  return jobs;
};

// Load runtime state (local only, not synced)
const loadCronState = () => {
  const state = loadFile("system/state/cron-runtime");
  // State is an object keyed by job name, or null if not found
  if (!state || typeof state !== 'object') {
    // Try backup
    const backup = loadFile("system/state/cron-runtime_bak");
    if (backup && typeof backup === 'object') {
      cronLogger.info('cron.state.restored_from_backup');
      saveFile("system/state/cron-runtime", backup);
      return backup;
    }
    return {};
  }
  const hasLegacyKeys = Object.keys(state).some((key) => legacyBuckets.has(key));
  if (!hasLegacyKeys) {
    return state;
  }

  const jobs = loadCronJobs();
  const migrated = migrateLegacyCronState(state, jobs);
  const nextState = { ...state };
  legacyBuckets.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(nextState, key)) {
      delete nextState[key];
    }
  });

  Object.entries(migrated).forEach(([jobKey, jobState]) => {
    const existing = nextState[jobKey];
    if (!existing) {
      nextState[jobKey] = jobState;
      return;
    }
    if (!existing.last_run && jobState.last_run) {
      existing.last_run = jobState.last_run;
    }
    if (!existing.status && jobState.status) {
      existing.status = jobState.status;
    }
    if (!existing.duration_ms && jobState.duration_ms) {
      existing.duration_ms = jobState.duration_ms;
    }
    if (!existing.nextRun) {
      existing.nextRun = jobState.nextRun;
    }
  });

  cronLogger.warn('cron.state.legacy_detected', {
    keys: Object.keys(state).filter((key) => legacyBuckets.has(key)),
    migratedJobs: Object.keys(migrated).length
  });
  saveFile("system/state/cron-runtime", nextState);
  return nextState;
};

// Merge job definitions with runtime state
const loadCronConfig = () => {
  const jobs = loadCronJobs();
  const state = loadCronState();

  return jobs.map(job => {
    const jobKey = job.id || job.name;
    return {
      ...job,
      last_run: state[jobKey]?.last_run || null,
      nextRun: state[jobKey]?.nextRun || null,
      status: state[jobKey]?.status || null,
      duration_ms: state[jobKey]?.duration_ms || 0,
      secondsUntil: null,  // Always recalculated
      needsToRun: false,   // Always recalculated
    };
  });
};


// Save runtime state only (not job definitions)
const saveCronState = (cronJobs) => {
  const state = loadCronState();
  for (const job of cronJobs) {
    const jobKey = job.id || job.name;
    state[jobKey] = {
      last_run: job.last_run,
      nextRun: job.nextRun,
      status: job.status || 'unknown',
      duration_ms: job.duration_ms || 0
    };
  }
  saveFile("system/state/cron-runtime", state);
};

// Backup runtime state
const backupCronState = (cronJobs) => {
  const state = loadCronState();
  for (const job of cronJobs) {
    const jobKey = job.id || job.name;
    state[jobKey] = {
      last_run: job.last_run,
      nextRun: job.nextRun,
      status: job.status || 'unknown',
      duration_ms: job.duration_ms || 0
    };
  }
  try {
    saveFile("system/state/cron-runtime_bak", state);
  } catch (error) {
    cronLogger.error('cron.backup.failed', { error: error?.message });
  }
};

export const cronContinuous = async () => {
  const now = moment().tz(timeZone);
  const cronJobs = loadCronConfig();
  if (!Array.isArray(cronJobs) || cronJobs.length === 0) {
    cronLogger.error('cron.config.invalid');
    return;
  }

  // Track if any job actually ran (to avoid unnecessary saves)
  let jobsRan = false;

  for (const job of cronJobs) {
    if (typeof job !== "object" || job === null) {
      cronLogger.warn('cron.job.invalid', { job });
      continue; // Skip invalid jobs
    }
    if (!job.nextRun) {
      job.cron_tab = job.cron_tab || job.schedule;
      if (!job.cron_tab) {
        cronLogger.error('cron.schedule.missing', { job: job.id || job.name });
        job.needsToRun = false;
        continue;
      }
      const nextMoment = computeNextRun(job, now);
      job.nextRun = nextMoment.format("YYYY-MM-DD HH:mm:ss");
      job.secondsUntil = nextMoment.unix() - now.unix();
      job.needsToRun = false;
      job.last_run = job.last_run || 0;
    } else {
      // echo countdown to job.nextRun
      // console.log(`Job ${job.name} next run in ${job.secondsUntil} seconds`);
    }
  }
  for (const job of cronJobs) {
    if (!moment.tz(job.nextRun, "YYYY-MM-DD HH:mm:ss", timeZone).isValid()) {
      cronLogger.warn('cron.nextRun.invalid', { job });
      job.needsToRun = false;
      continue; // Skip invalid jobs
    }
    const jobNextRun = moment.tz(job.nextRun, "YYYY-MM-DD HH:mm:ss", timeZone);
    const diff = jobNextRun.unix() - now.unix();
    job.secondsUntil = diff;
    if (diff <= 0) {
      job.needsToRun = true;
    } else {
      job.needsToRun = false;
    }
  }
  const runNow = [];
  for (const job of cronJobs) {
    if (job.needsToRun) {
      runNow.push(job);
    }
  }
  for (const job of runNow) {
    const jobKey = job.id || job.name;
    const jobName = job.name;

    // Phase 2: Dependency Check
    if (job.dependencies && Array.isArray(job.dependencies)) {
      const state = loadCronState();
      const unmet = job.dependencies.filter(depId => {
        const depState = state[depId];
        return !depState || depState.status !== 'success';
      });

      if (unmet.length > 0) {
        cronLogger.warn('cron.job.dependencies_unmet', { job: jobKey, unmet });
        job.needsToRun = false;
        continue;
      }
    }

    const jobFile = job.module ? [job.module] : cron[jobName];
    if (jobFile) {
      const guidId = crypto.randomUUID().split("-").pop();
      
      // Phase 2: Sequential Import
      const funcs = [];
      for (const item of jobFile) {
        try {
          if (typeof item === "string") {
            const module = await import(item);
            funcs.push(module.default);
          } else if (typeof item === "function") {
            funcs.push(item);
          }
        } catch (err) {
          cronLogger.error('cron.job.import_failed', { job: jobKey, item, error: err.message });
        }
      }

      const invoke = async (fn) => {
        const scopedLogger = cronLogger.child({ jobId: guidId, job: jobKey });
        const timeoutMs = job.timeout || 300000; // Default 5 minutes
        
        try {
          let result;
          const promise = (fn.length >= 2) ? fn(scopedLogger, guidId) : 
                          (fn.length === 1) ? fn(guidId) : 
                          fn(scopedLogger, guidId);
          
          // Race between execution and timeout
          result = await Promise.race([
            promise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Job timeout after ${timeoutMs}ms`)), timeoutMs)
            )
          ]);
          
          return { success: true, result };
        } catch (err) {
          scopedLogger.error('cron.harvester.error', {
            error: err?.message,
            harvester: fn?.name || 'unknown'
          });
          return { success: false, error: err.message };
        }
      };

      // Phase 2: Sequential Execution
      const startTime = Date.now();
      cronLogger.info('cron.job.started', { job: jobKey, guidId });
      let jobSucceeded = true;
      for (const fn of funcs) {
        if (typeof fn === "function") {
          const outcome = await invoke(fn);
          if (!outcome.success) jobSucceeded = false;
        } else {
          cronLogger.warn('cron.job.invalidFunction', { job: jobKey, fnType: typeof fn });
          jobSucceeded = false;
        }
      }
      job.status = jobSucceeded ? 'success' : 'failed';
      job.duration_ms = Date.now() - startTime;
      cronLogger.info('cron.job.finished', { 
        job: jobKey, 
        guidId, 
        status: job.status, 
        duration_ms: job.duration_ms 
      });
    }

    job.last_run = now.format("YYYY-MM-DD HH:mm:ss");
    jobsRan = true;  // Mark that we need to save state
    try {
      const newNextRunMoment = computeNextRun(job, now);
      job.nextRun = newNextRunMoment.format("YYYY-MM-DD HH:mm:ss");
      job.secondsUntil = newNextRunMoment.unix() - now.unix();
      job.needsToRun = false;
    } catch (e) {
      cronLogger.error('cron.schedule.compute.error', { job: jobKey, error: e?.message, stack: e?.stack });
      job.needsToRun = false;
      job.status = 'failed';
      job.error = "Invalid cron_tab";
    }
  }

  // Only save state when jobs actually ran (reduces writes from every 5s to only when needed)
  if (jobsRan) {
    saveCronState(cronJobs);
    backupCronState(cronJobs);
    cronLogger.debug('cron.state.saved', { jobsRan: runNow.map(j => j.name) });
  }
};

// Concurrency lock to prevent overlapping cron runs
let cronRunning = false;

// Only start cron scheduler in production to avoid Dropbox sync conflicts
if (cronEnabled) {
  setInterval(() => {
    if (cronRunning) {
      cronLogger.debug('cron.skipped.already_running');
      return;
    }
    cronRunning = true;
    cronContinuous()
      .catch(err => cronLogger.error('cron.run.error', { error: err?.message, stack: err?.stack }))
      .finally(() => { cronRunning = false; });
  }, 5000);
  cronLogger.info('cron.scheduler.started', { isDocker, interval: 5000 });
} else {
  cronLogger.info('cron.scheduler.disabled', {
    reason: 'Not running in Docker (dev mode). Set ENABLE_CRON=true to override.',
    isDocker
  });
}