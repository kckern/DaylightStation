"use strict";

import express from "express";
import crypto from "crypto";
import moment from "moment-timezone";
import { CronExpressionParser } from "cron-parser";
import Infinity from "../lib/infinity.mjs";
import { loadFile, saveFile } from "../lib/io.mjs";
import { createLogger } from '../lib/logging/logger.js';

const apiRouter = express.Router();
const timeZone = "America/Los_Angeles";

const cronLogger = createLogger({
  source: 'cron',
  app: 'scheduler',
  context: { env: process.env.NODE_ENV }
});

const cron = {
  // Every 10 minutes: Time-sensitive data (tasks, calendar, email, weather)
  cron10Mins: [
    "../lib/weather.mjs",
    "../lib/gcal.mjs",
    "../lib/todoist.mjs",
    "../lib/gmail.mjs",
  ],
  
  // Hourly: Health and fitness, music, task management, budgeting
  cronHourly: [
    "../lib/withings.mjs",      // Weight/body measurements
    "../lib/strava.mjs",         // Strava activities
    "../lib/lastfm.mjs",         // Music listening history
    "../lib/clickup.mjs",        // Task management
    "../lib/foursquare.mjs",        // Foursquare/Swarm check-ins
    "../lib/budget.mjs",         // Budget compilation and financial sync
  ],
  
  // Daily: Media consumption, religious content, task management, social activity
  cronDaily: [
    "../lib/youtube.mjs",        // YouTube downloads
    "../lib/fitsync.mjs",        // FitnessSyncer aggregation
    "../lib/garmin.mjs",         // Garmin data
    "../lib/health.mjs",         // Health data aggregation (combines strava/garmin/fitsync)
    "../lib/letterboxd.mjs",     // Movie watching history
    "../lib/goodreads.mjs",      // Reading activity
    "../lib/github.mjs",         // GitHub commit history
    "../lib/reddit.mjs",         // Reddit posts and comments
    "../lib/shopping.mjs",       // Shopping receipt extraction
    "../lib/archiveRotation.mjs", // Rotate old lifelog entries to cold archives
    "../lib/mediaMemoryValidator.mjs", // Validate media memory data integrity

   // "../lib/ldsgc.mjs",          // LDS General Conference
   // "../lib/scriptureguide.mjs", // Scripture of the day
  ],
  
  // Weekly: Financial data (expensive operations)
  cronWeekly: [
  ]
};

apiRouter.use((err, req, res, next) => {
  cronLogger.error('cron.middleware.error', { error: err?.message, stack: err?.stack });
  res.status(500).json({ error: err.message });
});

Object.keys(cron).forEach(key => {
  apiRouter.get(`/${key}`, async (req, res, next) => {
    try {
      const functions = await Promise.all(
        cron[key].map(async item => {
          if (typeof item === "string") {
            const module = await import(item);
            return module.default;
          } else if (typeof item === "function") {
            return item;
          }
          throw new Error(`Invalid item for ${key}`);
        })
      );
      const guidId = crypto.randomUUID().split("-").pop();
      cronLogger.info('cron.endpoint.called', { key, guidId });
      const data = {
        time: new Date().toISOString(),
        message: `Called endpoint for ${key}`,
        guidId
      };
      res.json(data);
      await Promise.all(functions.map(fn => fn(guidId)));
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
  const rawNext = CronExpressionParser.parse(job.cron_tab, {
    currentDate: fromMoment.toDate(),
    tz: timeZone
  }).next().toDate();
  const offsetMinutes = job.window
    ? Math.round(windowOffset(rawNext.toString()) * parseFloat(job.window))
    : 0;
  return moment(rawNext).add(offsetMinutes, "minutes").tz(timeZone);
}

// Load job definitions (synced via Dropbox)
const loadCronJobs = () => {
  const jobs = loadFile("system/cron-jobs");
  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    cronLogger.warn('cron.jobs.empty', { message: 'No cron jobs defined in system/cron-jobs' });
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
  return state;
};

// Merge job definitions with runtime state
const loadCronConfig = () => {
  const jobs = loadCronJobs();
  const state = loadCronState();

  return jobs.map(job => ({
    ...job,
    last_run: state[job.name]?.last_run || null,
    nextRun: state[job.name]?.nextRun || null,
    secondsUntil: null,  // Always recalculated
    needsToRun: false,   // Always recalculated
  }));
};

// Save runtime state only (not job definitions)
const saveCronState = (cronJobs) => {
  const state = {};
  for (const job of cronJobs) {
    state[job.name] = {
      last_run: job.last_run,
      nextRun: job.nextRun,
    };
  }
  saveFile("system/state/cron-runtime", state);
};

// Backup runtime state
const backupCronState = (cronJobs) => {
  const state = {};
  for (const job of cronJobs) {
    state[job.name] = {
      last_run: job.last_run,
      nextRun: job.nextRun,
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
    const jobName = job.name;
    const jobFile = cron[jobName];
    if (jobFile) {
      const guidId = crypto.randomUUID().split("-").pop();
      const funcs = await Promise.all(
        jobFile.map(async item => {
          if (typeof item === "string") {
            const module = await import(item);
            return module.default;
          } else if (typeof item === "function") {
            return item;
          }
          cronLogger.warn('cron.job.invalid_item', { jobName, item });
          return null; // Gracefully handle invalid items
        })
      );
      const invoke = (fn) => {
        const scopedLogger = cronLogger.child({ jobId: guidId, job: jobName });
        if (fn.length >= 2) return fn(scopedLogger, guidId);
        if (fn.length === 1) return fn(guidId);
        return fn(scopedLogger, guidId);
      };

      await Promise.all(
        funcs.map(fn => {
          if (typeof fn === "function") {
            return invoke(fn);
          }
          cronLogger.warn('cron.job.invalidFunction', { job: jobName, fnType: typeof fn });
          return null;
        })
      );
      job.messageIds = job.messageIds ? [...job.messageIds, guidId] : [guidId];
    }
    delete job.messageIds; // Remove messageIds after running
    job.last_run = now.format("YYYY-MM-DD HH:mm:ss");
    jobsRan = true;  // Mark that we need to save state
    try {
      const newNextRunMoment = computeNextRun(job, now);
      job.nextRun = newNextRunMoment.format("YYYY-MM-DD HH:mm:ss");
      job.secondsUntil = newNextRunMoment.unix() - now.unix();
      job.needsToRun = false;
    } catch (e) {
      cronLogger.error('cron.schedule.compute.error', { job: job.name, error: e?.message, stack: e?.stack });
      job.needsToRun = false;
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

setInterval(() => {
  cronContinuous().catch(err => cronLogger.error('cron.run.error', { error: err?.message, stack: err?.stack }));
}, 5000);