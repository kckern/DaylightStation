import { fileExists } from '#system/utils/FileIO.mjs';

export const isContainerRuntime = () => fileExists('/.dockerenv');

/**
 * Refresh tokens rotate: each refresh invalidates the last one. Only the copy that
 * keeps the result (the container) may refresh, unless a process opts in with
 * DAYLIGHT_TOKEN_WRITER=true.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.env=process.env]
 * @param {boolean} [opts.isContainer] - defaults to isContainerRuntime()
 * @returns {boolean}
 */
export const canRotateOAuthTokens = ({ env = process.env, isContainer = isContainerRuntime() } = {}) =>
  isContainer || env.DAYLIGHT_TOKEN_WRITER === 'true';
