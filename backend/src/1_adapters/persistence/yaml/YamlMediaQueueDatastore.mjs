/**
 * YamlMediaQueueDatastore - YAML-based media queue persistence
 *
 * Implements IMediaQueueDatastore port for media queue storage.
 * Queue is stored at: household[-{id}]/apps/media/queue.yml
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IMediaQueueDatastore } from '#apps/media/ports/IMediaQueueDatastore.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlMediaQueueDatastore extends IMediaQueueDatastore {
  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService instance for path resolution
   */
  constructor(config) {
    super();
    if (!config.configService) {
      throw new InfrastructureError('YamlMediaQueueDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService',
      });
    }
    this.configService = config.configService;
  }

  /**
   * Get the file path for the queue YAML file (without extension).
   * @param {string} householdId
   * @returns {string}
   */
  _getQueuePath(householdId) {
    const mediaDir = this.configService.getHouseholdPath('apps/media', householdId);
    return path.join(mediaDir, 'queue');
  }

  /**
   * Load a media queue for a household.
   * @param {string} householdId
   * @returns {Promise<MediaQueue|null>}
   */
  async load(householdId) {
    const queuePath = this._getQueuePath(householdId);
    const data = loadYamlSafe(queuePath);
    if (!data) return null;
    return MediaQueue.fromJSON(data);
  }

  /**
   * Save a media queue for a household.
   * @param {MediaQueue} mediaQueue
   * @param {string} householdId
   * @returns {Promise<void>}
   */
  async save(mediaQueue, householdId) {
    const queuePath = this._getQueuePath(householdId);
    const dir = path.dirname(queuePath);
    ensureDir(dir);
    const data = typeof mediaQueue.toJSON === 'function'
      ? mediaQueue.toJSON()
      : mediaQueue;
    saveYaml(queuePath, data);
  }
}

export default YamlMediaQueueDatastore;
