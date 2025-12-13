"use strict";

import express from "express";
import crypto from "crypto";
import moment from "moment-timezone";
import { CronExpressionParser } from "cron-parser";
import Infinity from "./lib/infinity.js";
import { loadFile, saveFile } from "./lib/io.mjs";
import { createLogger } from './lib/logging/logger.js';

const apiRouter = express.Router();
const timeZone = "America/Los_Angeles";

const cronLogger = createLogger({
  source: 'cron',
  app: 'scheduler',
  context: { env: process.env.NODE_ENV }
});

const cron = {
  cron10Mins: [
    "./lib/weather.js",
     "./lib/gcal.js",
     "./lib/todoist.js",
     "./lib/gmail.js",
  ],
  cronHourly: [
     "./lib/withings.mjs",
 //    "./lib/fitsync.mjs",
 //    "./lib/strava.mjs",
   //  "./lib/health.mjs",
   //  "./lib/garmin.mjs",
    // ...Infinity.keys.map(key => (req) => Infinity.loadData(key, req)),
  ],
  cronDaily: [
     "./lib/clickup.js",
     "./lib/youtube.mjs",
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

// Helper function to safely load cron config with backup fallback
const loadCronConfig = () => {
  let cronJobs = loadFile("config/cron");
  
  // If cron config is corrupt, empty, or not an array, try to load backup
  if (!cronJobs || !Array.isArray(cronJobs) || cronJobs.length === 0) {
 //   console.warn("Main cron config is empty or corrupt, attempting to load backup...");
    const cronBackup = loadFile("config/cron_bak");
    
    if (cronBackup && Array.isArray(cronBackup) && cronBackup.length > 0) {
   //   console.log("Successfully loaded cron backup, restoring main config...");
      cronJobs = cronBackup;
      // Restore the main config file from backup
      saveFile("config/cron", cronJobs);
    } else {
    //  console.error("Both main cron config and backup are unavailable or corrupt.");
      return [];
    }
  }
  
  return cronJobs;
};

// Helper function to create backup after successful execution
const backupCronConfig = (cronJobs) => {
  if (Array.isArray(cronJobs) && cronJobs.length > 0) {
    try {
      saveFile("config/cron_bak", cronJobs);
    //  console.log(`Cron config backed up with ${cronJobs.length} jobs`);
    } catch (error) {
    //  console.error("Failed to backup cron config:", error);
    }
  }
};

export const cronContinuous = async () => {
  const now = moment().tz(timeZone);
  const cronJobs = loadCronConfig();
  if (!Array.isArray(cronJobs)) {
    cronLogger.error('cron.config.invalid');
    return;
  }for (const job of cronJobs) {
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
          console.warn(`Invalid cron item for ${jobName}:`, item);
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
  saveFile("config/cron", cronJobs);
  
  // Create backup after successful execution if there are jobs
  backupCronConfig(cronJobs);
};

setInterval(() => {
  cronContinuous().catch(err => cronLogger.error('cron.run.error', { error: err?.message, stack: err?.stack }));
}, 5000);