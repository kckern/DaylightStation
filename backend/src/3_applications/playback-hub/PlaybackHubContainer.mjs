/**
 * PlaybackHubContainer - DI wiring for the playback-hub bounded context.
 *
 * Constructed at backend boot with the production adapters
 * (HttpPlaybackHubAdapter + YamlHubConfigDatastore — Phase 3) and the event
 * bus. Exposes:
 *   - One use-case getter per Phase 2 use case (memoized).
 *   - .broadcaster (the long-running runtime service).
 *   - .start() / .stop() — lifecycle hooks invoked from bootstrap.mjs.
 */

import { GetHubStatus } from './usecases/GetHubStatus.mjs';
import { GetHubConfig } from './usecases/GetHubConfig.mjs';
import { SendHubCommand } from './usecases/SendHubCommand.mjs';
import { UpdateDeviceConfig } from './usecases/UpdateDeviceConfig.mjs';
import { SaveScheduledFire } from './usecases/SaveScheduledFire.mjs';
import { DeleteScheduledFire } from './usecases/DeleteScheduledFire.mjs';
import { VerifyAudioFlowing } from './usecases/VerifyAudioFlowing.mjs';
import { HubStatusBroadcaster } from './runtime/HubStatusBroadcaster.mjs';

export class PlaybackHubContainer {
  /** @type {import('./ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {import('./ports/IHubConfigRepository.mjs').IHubConfigRepository} */ #configRepository;
  /** @type {{ publish: Function }} */ #eventPublisher;
  /** @type {object} */ #logger;
  /** @type {object} */ #broadcasterOptions;

  #getHubStatus;
  #getHubConfig;
  #sendHubCommand;
  #updateDeviceConfig;
  #saveScheduledFire;
  #deleteScheduledFire;
  #verifyAudioFlowing;
  #broadcaster;

  /**
   * @param {{
   *   gateway: import('./ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   configRepository: import('./ports/IHubConfigRepository.mjs').IHubConfigRepository,
   *   eventPublisher: { publish: Function },
   *   logger?: object,
   *   broadcasterOptions?: { intervalMs?: number, maxBackoffMs?: number, sleepFn?: Function }
   * }} deps
   */
  constructor({ gateway, configRepository, eventPublisher, logger, broadcasterOptions = {} } = {}) {
    if (!gateway) throw new Error('PlaybackHubContainer: gateway required');
    if (!configRepository) throw new Error('PlaybackHubContainer: configRepository required');
    if (!eventPublisher || typeof eventPublisher.publish !== 'function') {
      throw new Error('PlaybackHubContainer: eventPublisher with publish() required');
    }
    this.#gateway = gateway;
    this.#configRepository = configRepository;
    this.#eventPublisher = eventPublisher;
    this.#logger = logger || console;
    this.#broadcasterOptions = broadcasterOptions;
  }

  /** @returns {GetHubStatus} */
  get getHubStatus() {
    if (!this.#getHubStatus) {
      this.#getHubStatus = new GetHubStatus({
        headsetHubGateway: this.#gateway,
        logger: this.#logger
      });
    }
    return this.#getHubStatus;
  }

  /** @returns {GetHubConfig} */
  get getHubConfig() {
    if (!this.#getHubConfig) {
      this.#getHubConfig = new GetHubConfig({
        hubConfigRepository: this.#configRepository,
        logger: this.#logger
      });
    }
    return this.#getHubConfig;
  }

  /** @returns {SendHubCommand} */
  get sendHubCommand() {
    if (!this.#sendHubCommand) {
      this.#sendHubCommand = new SendHubCommand({
        headsetHubGateway: this.#gateway,
        hubConfigRepository: this.#configRepository,
        logger: this.#logger
      });
    }
    return this.#sendHubCommand;
  }

  /** @returns {UpdateDeviceConfig} */
  get updateDeviceConfig() {
    if (!this.#updateDeviceConfig) {
      this.#updateDeviceConfig = new UpdateDeviceConfig({
        hubConfigRepository: this.#configRepository,
        logger: this.#logger
      });
    }
    return this.#updateDeviceConfig;
  }

  /** @returns {SaveScheduledFire} */
  get saveScheduledFire() {
    if (!this.#saveScheduledFire) {
      this.#saveScheduledFire = new SaveScheduledFire({
        hubConfigRepository: this.#configRepository,
        logger: this.#logger
      });
    }
    return this.#saveScheduledFire;
  }

  /** @returns {DeleteScheduledFire} */
  get deleteScheduledFire() {
    if (!this.#deleteScheduledFire) {
      this.#deleteScheduledFire = new DeleteScheduledFire({
        hubConfigRepository: this.#configRepository,
        logger: this.#logger
      });
    }
    return this.#deleteScheduledFire;
  }

  /** @returns {VerifyAudioFlowing} */
  get verifyAudioFlowing() {
    if (!this.#verifyAudioFlowing) {
      this.#verifyAudioFlowing = new VerifyAudioFlowing({
        gateway: this.#gateway,
        logger: this.#logger,
      });
    }
    return this.#verifyAudioFlowing;
  }

  /** @returns {HubStatusBroadcaster} */
  get broadcaster() {
    if (!this.#broadcaster) {
      this.#broadcaster = new HubStatusBroadcaster({
        gateway: this.#gateway,
        eventPublisher: this.#eventPublisher,
        logger: this.#logger,
        ...this.#broadcasterOptions
      });
    }
    return this.#broadcaster;
  }

  /**
   * Start long-running services. Invoked from bootstrap.mjs.
   */
  async start() {
    this.broadcaster.start();
  }

  /**
   * Stop long-running services cleanly. Awaits in-flight iterations.
   */
  async stop() {
    if (this.#broadcaster) {
      await this.#broadcaster.stop();
    }
  }
}

export default PlaybackHubContainer;
