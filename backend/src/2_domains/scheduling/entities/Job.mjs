import { ValidationError } from '../../core/errors/index.mjs';

/**
 * Job Entity - Represents a scheduled task definition
 */
export class Job {
  constructor({
    id,
    name,
    module,
    schedule,
    window = 0,
    timeout = 300000,
    dependencies = [],
    enabled = true,
    bucket = null
  }) {
    this.id = id;
    this.name = name;
    this.module = module;
    this.schedule = schedule;
    this.cronTab = schedule; // Alias for legacy compatibility
    this.window = parseFloat(window) || 0;
    this.timeout = timeout;
    this.dependencies = dependencies;
    this.enabled = enabled;
    this.bucket = bucket;
  }

  /**
   * Check if job has dependencies
   */
  hasDependencies() {
    return this.dependencies.length > 0;
  }

  /**
   * Validate the job configuration
   */
  validate() {
    if (!this.id) throw new ValidationError('Job requires id', { code: 'MISSING_ID', field: 'id' });
    if (!this.module) throw new ValidationError('Job requires module', { code: 'MISSING_MODULE', field: 'module' });
    if (!this.schedule) throw new ValidationError('Job requires schedule', { code: 'MISSING_SCHEDULE', field: 'schedule' });
    return true;
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      module: this.module,
      schedule: this.schedule,
      window: this.window,
      timeout: this.timeout,
      dependencies: this.dependencies,
      enabled: this.enabled,
      bucket: this.bucket
    };
  }

  /**
   * Create Job from plain object
   */
  static fromObject(obj) {
    return new Job({
      id: obj.id || obj.name,
      name: obj.name || obj.id,
      module: obj.module,
      schedule: obj.schedule || obj.cron_tab,
      window: obj.window,
      timeout: obj.timeout,
      dependencies: obj.dependencies || [],
      enabled: obj.enabled !== false,
      bucket: obj.bucket
    });
  }
}

export default Job;
