/**
 * configErrors — a household dashboard config the domain rejected is a
 * configuration problem, not a bad request and not a bug.
 *
 * Domain policies throw `ValidationError` with a `field`; this turns one into a
 * `ConfigurationError` whose `key` names the YAML path. Fields that already
 * carry their section ("timeline.lanes[0].entity") keep it; bare fields
 * ("exclude") are prefixed with `section`. Anything else is rethrown unchanged.
 */

import { ConfigurationError } from '#apps/common/errors/SemanticErrors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * @param {unknown} error
 * @param {string} section - the YAML section a bare field belongs to
 * @returns {never}
 */
export function toConfigurationError(error, section) {
  if (!(error instanceof ValidationError)) throw error;
  const key = error.field?.includes('.') ? error.field : `${section}.${error.field}`;
  throw new ConfigurationError(`home dashboard config: ${error.message}`, { key, value: error.value });
}

export default toConfigurationError;
