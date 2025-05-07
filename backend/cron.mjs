import express from 'express';
import crypto from 'crypto';
const apiRouter = express.Router();
import Infinity from './lib/infinity.js';
import { loadFile, saveFile } from './lib/io.mjs';
import { CronExpressionParser } from 'cron-parser';

import moment from 'moment-timezone';
const harvesters = Infinity.keys.map(key => (req) => Infinity.loadData(key, req));
const cron = {
    cron10Mins: [
        './lib/weather.js',
        './lib/gcal.js',
        './lib/todoist.js',
        './lib/gmail.js',
    ],
    cronHourly: [    
        './lib/withings.mjs',
        ...harvesters,
        //video lists
    ],
    cronDaily: [
        //'./lib/withings.mjs',
        './lib/clickup.js',
        //"./lib/plex.mjs",
        "./lib/youtube.mjs",
    ]
}

// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

Object.keys(cron).forEach(key => {
    apiRouter.get(`/${key}`, async (req, res, next) => {
        try {
            const functions = await Promise.all(cron[key].map(async (item) => {
                if (typeof item === 'string') {
                    const module = await import(item);
                    return module.default;
                } else if (typeof item === 'function') {
                    return item;
                } else {
                    throw new Error(`Invalid cron item type for ${key}`);
                }
            }));

            const guidId = crypto.randomUUID().split('-').pop();
            console.log(`\n\n[${key}] Job ID: ${guidId}`);
            const data = {
                time: new Date().toISOString(),
                message: `This endpoint is called for ${key}`,
                guidId
            }
            res.json(data);

            await Promise.all(functions.map(fn => fn(guidId)));

        } catch (err) {
            next(err);
        }
    });
});

export default apiRouter;

const md5 = (string) => {
    return crypto.createHash('md5').update(string).digest('hex');
};

const timeZone = 'America/Los_Angeles'; // Set your desired timezone here
// A helper to compute an offset fraction from a string (optionally used below).
const windowOffset = (str) => {
  const md5hash = md5(str);
  // Extract up to 3 trailing digits from the MD5, interpret as an int
  const numeric = parseInt(md5hash.replace(/[^0-9]/g, '').slice(-3)) || 0;
  // Range is up to 999
  const max = 999;
  // For example, yields a floating offset from -0.5 to +0.5
  return 0.5 - (numeric / max);
};

/**
 * Parse and return the next run time for a job’s cron expression
 * plus an optional “window” offset in minutes.
 */
function computeNextRun(job, fromMoment) {
  const rawNextRun = CronExpressionParser.parse(job.cron_tab, {
    currentDate: fromMoment.toDate(),
    tz: timeZone
  }).next().toDate();

  // If the “window” field is numeric, multiply the offset fraction by that many minutes.
  const offsetMinutes = (job.window)
    ? Math.round(windowOffset(rawNextRun.toString()) * parseFloat(job.window))
    : 0;

  const nextRunMoment = moment(rawNextRun).add(offsetMinutes, 'minutes').tz(timeZone);
  return nextRunMoment;
}

export const cronContinuous = async () => {
  const now = moment().tz(timeZone);
  let cronJobs = loadFile('cron') || [];

  // Step 1: Ensure every job has a “nextRun” if it’s missing.
  for (const job of cronJobs) {
    // If no nextRun is defined, compute one from 'now'.
    if (!job.nextRun) {
      const nextMoment = computeNextRun(job, now);
      job.nextRun = nextMoment.format('YYYY-MM-DD HH:mm:ss');
      job.secondsUntil = nextMoment.unix() - now.unix();
      job.needsToRun = false; 
      // last_run might be 0 or undefined for a newly added job
      job.last_run = job.last_run || 0;
    }
  }
  
  // Step 2: For each job, update secondsUntil based on the stored nextRun, 
  // and decide if needsToRun = true ( ONLY if nextRun is in the past, last_run < nextRun ).
  for (const job of cronJobs) {
    const jobNextRun = moment.tz(job.nextRun, 'YYYY-MM-DD HH:mm:ss', timeZone);
    const diff = jobNextRun.unix() - now.unix();
    job.secondsUntil = diff; // May be negative if past due

    // If the job is past due and we haven't run it since that nextRun time, it needs to run.
    if (diff <= 0) {
      job.needsToRun = true;
    } else {
      job.needsToRun = false;
    }
  }

  // Persist the updated secondsUntil and needsToRun flags
  saveFile('cron', cronJobs);

  // Step 3: Identify jobs to run right now (needsToRun = true).
  const runNow = [];
  const runLater = [];
  
  for (const job of cronJobs) {
    if (job.needsToRun) {
      runNow.push(job);
    } else {
      runLater.push(job);
    }
  }

  // Step 4: Actually run the needed jobs
  const messageIds = [];
  for (const job of runNow) {
    const jobName = job.name;
    const jobFile = cron[jobName];
    if (jobFile) {
      const functions = await Promise.all(jobFile.map(async (item) => {
        if (typeof item === 'string') {
          const module = await import(item);
          return module.default;
        } else if (typeof item === 'function') {
          return item;
        }
        throw new Error(`Invalid cron item type for ${jobName}`);
      }));

      const guidId = crypto.randomUUID().split('-').pop();
      messageIds.push(guidId);

      await Promise.all(functions.map(fn => fn(guidId)));
    }

    job.messageIds = messageIds;
    job.last_run = now.format('YYYY-MM-DD HH:mm:ss');
    const newNextRunMoment = computeNextRun(job, now); // We parse from "now," not the old nextRun
    job.nextRun = newNextRunMoment.format('YYYY-MM-DD HH:mm:ss');
    job.secondsUntil = newNextRunMoment.unix() - now.unix(); // likely positive
    job.needsToRun = false;
  }

  // Step 5: Persist updated data so these changes persist between cronContinuous invocations
  saveFile('cron', cronJobs);

  //

 
};
  
// Run cron continuously on a separate thread
setInterval(() => {
    cronContinuous().catch(err => console.error('Error running cron jobs:', err));
}, 5 * 1000);