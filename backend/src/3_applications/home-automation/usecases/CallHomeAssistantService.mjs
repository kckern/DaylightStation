/**
 * CallHomeAssistantService use case.
 *
 * Generic wrapper around `haGateway.callService(domain, service, data)`.
 *
 * Used by the `/ha/call` and `/ha/script/:scriptId` API endpoints, which
 * MUST NOT reach into the adapter layer directly. The use case enforces:
 *
 *   - `domain` and `service` are non-empty strings (ValidationError otherwise).
 *   - The HA gateway is wired (ApplicationError with HA_NOT_CONFIGURED otherwise).
 *
 * Gateway errors are propagated unchanged — the API layer maps them to HTTP.
 *
 * Returns `{ domain, service, data, result }` so the API layer can echo the
 * request payload alongside HA's response.
 *
 * @module 3_applications/home-automation/usecases/CallHomeAssistantService
 */

import { ValidationError } from '#system/utils/errors/index.mjs';
import { ApplicationError } from '#apps/common/errors/index.mjs';

export class CallHomeAssistantService {
  #haGateway;
  #logger;

  /**
   * @param {{
   *   haGateway?: { callService: (domain: string, service: string, data: object) => Promise<*> } | null,
   *   logger?: object
   * }} deps
   */
  constructor({ haGateway, logger } = {}) {
    this.#haGateway = haGateway || null;
    this.#logger = logger || console;
  }

  /**
   * Execute a Home Assistant service call.
   *
   * @param {{ domain: string, service: string, data?: object }} input
   * @returns {Promise<{ domain: string, service: string, data: object, result: * }>}
   * @throws {ValidationError} when `domain` or `service` is missing/empty.
   * @throws {ApplicationError} when the HA gateway is not configured.
   */
  async execute({ domain, service, data = {} } = {}) {
    if (!domain) {
      throw new ValidationError('domain required', {
        code: 'HA_CALL_MISSING_DOMAIN',
        field: 'domain',
      });
    }
    if (!service) {
      throw new ValidationError('service required', {
        code: 'HA_CALL_MISSING_SERVICE',
        field: 'service',
      });
    }
    if (!this.#haGateway) {
      throw new ApplicationError('Home Assistant gateway not configured', {
        code: 'HA_NOT_CONFIGURED',
      });
    }

    this.#logger.info?.('home-automation.ha.call', { domain, service, data });
    const result = await this.#haGateway.callService(domain, service, data);
    return { domain, service, data, result };
  }
}

export default CallHomeAssistantService;
