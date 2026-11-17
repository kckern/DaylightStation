import { buildHeaders } from '../../lib/api.mjs';
import { getLogger } from '../../lib/logging/Logger.js';

export function createParticipantLaunchClient(fetcher = (...args) => fetch(...args)) {
  async function request(operation, input) {
    const logger = getLogger();
    logger.info('participant-launch.request', { operation });
    try {
      const response = await fetcher(`/api/v1/participant-launches/${operation}`, {
        method: 'POST', headers: buildHeaders(localStorage.getItem('ds_token'), true), body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.message || 'Launch request failed'), data, { status: response.status });
      logger.info('participant-launch.response', { operation, kind: data.kind });
      return data;
    } catch (error) {
      logger.warn('participant-launch.error', { operation, code: error.code, status: error.status });
      throw error;
    }
  }
  return Object.fromEntries(['inspect', 'begin', 'resume'].map(operation => [operation, input => request(operation, input)]));
}
export const participantLaunchClient = createParticipantLaunchClient();
