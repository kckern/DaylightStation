/**
 * StravaWebhookJobStore
 *
 * Durable job queue backed by YAML files. Persists webhook events
 * so enrichment survives crashes, deploys, and Docker restarts.
 *
 * Location: data/household/common/strava/strava-webhooks/{activityId}.yml
 *
 * @module adapters/strava/StravaWebhookJobStore
 */

import fs from 'fs';
import path from 'path';
import { loadYaml, saveYaml, ensureDir, listYamlFiles, dirExists } from '#system/utils/FileIO.mjs';

export class StravaWebhookJobStore {
  #basePath;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.basePath - Absolute path to job directory
   * @param {Object} [config.logger]
   */
  constructor({ basePath, logger = console }) {
    this.#basePath = basePath;
    this.#logger = logger;
  }

  /**
   * Create a new job from a webhook event.
   * @param {Object} event - FitnessProviderEvent
   * @returns {Object} The created job
   */
  create(event) {
    const job = {
      activityId: event.objectId,
      ownerId: event.ownerId,
      eventTime: event.eventTime,
      receivedAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      matchedSessionId: null,
    };

    ensureDir(this.#basePath);
    const filePath = this._jobPath(event.objectId);
    saveYaml(filePath, job);

    this.#logger.info?.('strava.job.created', { activityId: event.objectId });
    return job;
  }

  /**
   * Find a job by activity ID.
   * @param {string|number} activityId
   * @returns {Object|null}
   */
  findById(activityId) {
    const filePath = this._jobPath(activityId);
    return loadYaml(filePath) || null;
  }

  /**
   * Update a job's fields.
   * @param {string|number} activityId
   * @param {Object} updates - Fields to merge
   * @returns {Object|null} Updated job
   */
  update(activityId, updates) {
    const job = this.findById(activityId);
    if (!job) return null;

    const updated = { ...job, ...updates };
    saveYaml(this._jobPath(activityId), updated);
    return updated;
  }

  /**
   * Find all jobs with a given status.
   * @param {string} status - 'pending' | 'completed' | 'unmatched'
   * @returns {Array<Object>}
   */
  findByStatus(status) {
    if (!dirExists(this.#basePath)) return [];

    const files = listYamlFiles(this.#basePath);
    const results = [];

    for (const file of files) {
      const job = loadYaml(path.join(this.#basePath, file));
      if (job?.status === status) {
        results.push(job);
      }
    }

    return results;
  }

  /**
   * Find all pending or unmatched jobs (for startup recovery).
   * @returns {Array<Object>}
   */
  findActionable() {
    if (!dirExists(this.#basePath)) return [];

    const files = listYamlFiles(this.#basePath);
    const results = [];

    for (const file of files) {
      const job = loadYaml(path.join(this.#basePath, file));
      if (job && (job.status === 'pending' || job.status === 'unmatched')) {
        results.push(job);
      }
    }

    return results;
  }

  /**
   * Delete completed jobs older than maxAge.
   * @param {number} maxAgeMs - Max age in milliseconds (default: 7 days)
   * @returns {number} Number of jobs cleaned up
   */
  cleanupCompleted(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    if (!dirExists(this.#basePath)) return 0;

    const files = listYamlFiles(this.#basePath);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(this.#basePath, file);
      const job = loadYaml(filePath);
      if (!job || job.status !== 'completed') continue;

      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      if (completedAt && (now - completedAt) > maxAgeMs) {
        try {
          const resolved = filePath.endsWith('.yml') ? filePath : `${filePath}.yml`;
          fs.unlinkSync(resolved);
          cleaned++;
        } catch { /* ignore */ }
      }
    }

    if (cleaned > 0) {
      this.#logger.info?.('strava.job.cleanup', { cleaned });
    }
    return cleaned;
  }

  /**
   * @private
   */
  _jobPath(activityId) {
    return path.join(this.#basePath, String(activityId));
  }
}

export default StravaWebhookJobStore;
