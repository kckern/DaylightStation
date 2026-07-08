/**
 * HttpPlaybackHubAdapter — IPlaybackHubGateway via HTTP to the playback hub.
 *
 * Wire-format conventions (matches `_extensions/playback-hub/web.py`):
 *
 *   GET /api/status
 *     200 → JSON array of slot status objects (see SlotStatus.fromHubJson)
 *
 *   POST /api/play
 *     Request:
 *       {
 *         "action":      "play"|"stop"|"pause"|"next"|"prev"|"volume",
 *         "target":      "red" | "red,yellow",        // comma-joined color list
 *         "content_id":  "670208" | "spotify:track123", // optional; bare plex-ID
 *         "volume":      45,                            // optional
 *         "duration_min": 30                            // optional
 *       }
 *     Responses:
 *       200 → CommandResult-shaped JSON, OR legacy `{ok, applied:N, skipped:N}`
 *       409 → CommandResult.skipped[{reason:'contention'}] (DO NOT throw)
 *       4xx/5xx → throw InfrastructureError
 *       timeout/network → throw InfrastructureError
 *
 * `applied` strings in the response are accepted as-is. `skipped[].reason`
 * values not in CommandResult.REASONS are mapped to 'invalid-target' as the
 * safest known reason (the caller decides what to do — they're explicitly
 * told the request was rejected).
 */

import { CommandResult } from '../../2_domains/playback-hub/value-objects/CommandResult.mjs';
import { SlotStatus } from '../../2_domains/playback-hub/value-objects/SlotStatus.mjs';
import { InfrastructureError } from '../../0_system/utils/errors/InfrastructureError.mjs';
import { HttpClient } from '../../0_system/services/HttpClient.mjs';

const VALID_REASONS = new Set(CommandResult.REASONS);

export class HttpPlaybackHubAdapter {
  /** @type {string} */ #baseUrl;
  /** @type {number} */ #timeoutMs;
  /** @type {object} */ #logger;
  /** @type {import('../../0_system/services/HttpClient.mjs').HttpClient} */ #httpClient;

  /**
   * @param {{
   *   baseUrl: string,
   *   requestTimeoutSec?: number,
   *   logger?: object,
   *   httpClient?: import('../../0_system/services/HttpClient.mjs').HttpClient
   * }} opts
   */
  constructor({ baseUrl, requestTimeoutSec = 2, logger, httpClient } = {}) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new InfrastructureError('HttpPlaybackHubAdapter requires baseUrl', {
        code: 'MISSING_CONFIG', field: 'baseUrl', value: baseUrl
      });
    }
    if (typeof requestTimeoutSec !== 'number' || !Number.isFinite(requestTimeoutSec) || requestTimeoutSec <= 0) {
      throw new InfrastructureError('HttpPlaybackHubAdapter.requestTimeoutSec must be a positive number', {
        code: 'INVALID_CONFIG', field: 'requestTimeoutSec', value: requestTimeoutSec
      });
    }
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#timeoutMs = Math.max(1, Math.round(requestTimeoutSec * 1000));
    this.#logger = logger || console;
    this.#httpClient = httpClient || new HttpClient({ logger: this.#logger });
  }

  /**
   * @returns {Promise<SlotStatus[]>}
   */
  async getStatus() {
    const response = await this.#request('GET', '/api/status', null);
    if (response.status >= 500 || response.status >= 400) {
      throw new InfrastructureError(
        `playback hub /api/status returned ${response.status}`,
        { code: 'HUB_HTTP_ERROR', status: response.status }
      );
    }
    const json = response.body;
    if (!Array.isArray(json)) {
      throw new InfrastructureError('playback hub /api/status: expected JSON array', {
        code: 'HUB_BAD_RESPONSE', body: typeof json
      });
    }
    return json.map(entry => SlotStatus.fromHubJson(entry));
  }

  /**
   * @param {import('../../2_domains/playback-hub/value-objects/PlayCommand.mjs').PlayCommand} playCommand
   * @param {import('../../2_domains/playback-hub/entities/HubDevice.mjs').HubDevice[]} targets
   * @returns {Promise<CommandResult>}
   */
  async sendCommand(playCommand, targets) {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new InfrastructureError('HttpPlaybackHubAdapter.sendCommand requires non-empty targets', {
        code: 'INVALID_TARGETS', value: targets
      });
    }
    const targetColors = targets.map(d => d.color.value);
    const body = this.#buildPlayBody(playCommand, targetColors);
    const response = await this.#request('POST', '/api/play', body);

    if (response.status === 409) {
      // Hub explicitly signalled "another command in flight" / busy state.
      // Map every requested target to skipped[contention] — caller can retry.
      return new CommandResult({
        applied: [],
        skipped: targetColors.map(color => ({ color, reason: 'contention' }))
      });
    }

    if (response.status >= 400) {
      throw new InfrastructureError(
        `playback hub /api/play returned ${response.status}`,
        { code: 'HUB_HTTP_ERROR', status: response.status, body: response.body }
      );
    }

    return this.#parseCommandResult(response.body, targetColors);
  }

  /**
   * GET /api/verify/<color> — sample the BT sink's PipeWire monitor port
   * and return the peak-meter snapshot.
   *
   * @param {string} color
   * @returns {Promise<{
   *   color: string,
   *   sink: string,
   *   peak_dbfs: number|null,
   *   audio_flowing: boolean,
   *   sampled_ms: number,
   *   bt_connected: boolean
   * }>}
   */
  async verifyAudio(color) {
    const path = `/api/verify/${encodeURIComponent(color)}`;
    const response = await this.#request('GET', path, null);
    if (response.status >= 400) {
      throw new InfrastructureError(
        `playback hub ${path} returned ${response.status}`,
        { code: 'HUB_HTTP_ERROR', status: response.status, body: response.body }
      );
    }
    const body = response.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new InfrastructureError(`playback hub ${path}: expected JSON object`, {
        code: 'HUB_BAD_RESPONSE', body: typeof body
      });
    }
    return body;
  }

  // -----------------------------------------------------------------------
  // Private — request shape
  // -----------------------------------------------------------------------

  /**
   * Build the POST body for /api/play from a PlayCommand + target colors.
   * Strips `plex:` prefix from content_id (the hub expects bare Plex IDs);
   * preserves other source prefixes (e.g. `spotify:track123` stays intact).
   * @private
   */
  #buildPlayBody(playCommand, targetColors) {
    const body = {
      action: playCommand.action,
      target: targetColors.join(',')
    };
    if (playCommand.queue) {
      const { source, id } = playCommand.queue;
      body.content_id = source === 'plex' ? id : `${source}:${id}`;
    }
    if (playCommand.volume !== null && playCommand.volume !== undefined) {
      body.volume = playCommand.volume;
    }
    if (playCommand.durationMin !== null && playCommand.durationMin !== undefined) {
      body.duration_min = playCommand.durationMin;
    }
    return body;
  }

  /**
   * Parse a /api/play response body into a CommandResult.
   *
   * Accepts both:
   *   - Modern shape: `{ ok, applied: ['red'], skipped: [{color, reason}] }`
   *   - Legacy shape: `{ ok, action, applied: N, skipped: N }` (numeric counts)
   *
   * Legacy counts get mapped onto the requested target list — if applied > 0
   * we treat the request's targets as applied; if skipped > 0 we record them
   * as `invalid-target` (the most conservative known reason).
   * @private
   */
  #parseCommandResult(body, targetColors) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new InfrastructureError('playback hub /api/play: expected JSON object', {
        code: 'HUB_BAD_RESPONSE', body
      });
    }

    let applied = [];
    let skipped = [];

    if (Array.isArray(body.applied)) {
      applied = body.applied.filter(c => typeof c === 'string');
    } else if (typeof body.applied === 'number' && body.applied > 0) {
      // Legacy: numeric count → all requested targets were applied.
      applied = [...targetColors];
    }

    if (Array.isArray(body.skipped)) {
      skipped = body.skipped
        .filter(s => s && typeof s === 'object' && typeof s.color === 'string')
        .map(s => ({
          color: s.color,
          reason: VALID_REASONS.has(s.reason) ? s.reason : 'invalid-target'
        }));
    } else if (typeof body.skipped === 'number' && body.skipped > 0) {
      // Legacy: numeric count and no explicit colors. We don't know which
      // target failed — record every target NOT in applied as skipped.
      const appliedSet = new Set(applied);
      skipped = targetColors
        .filter(c => !appliedSet.has(c))
        .map(color => ({ color, reason: 'invalid-target' }));
    }

    return new CommandResult({ applied, skipped });
  }

  // -----------------------------------------------------------------------
  // Private — fetch with timeout, error wrapping
  // -----------------------------------------------------------------------

  /**
   * Single chokepoint for HTTP. Always returns {status, body} on response
   * received; throws InfrastructureError on network / timeout failure.
   * @private
   */
  async #request(method, path, body) {
    const url = `${this.#baseUrl}${path}`;

    let response;
    try {
      response = await this.#httpClient.requestRaw(method, url, {
        body: body === undefined ? null : body,
        headers: { 'Accept': 'application/json' },
        responseType: 'text',
        timeout: this.#timeoutMs
      });
    } catch (err) {
      // HttpClient surfaces network/timeout as HttpError; map to hub errors.
      // AbortError (timeout) is coded 'TIMEOUT' by HttpError.fromNetworkError.
      if (err && (err.code === 'TIMEOUT' || err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        throw new InfrastructureError(
          `playback hub request timeout after ${this.#timeoutMs}ms: ${method} ${path}`,
          { code: 'HUB_TIMEOUT', timeoutMs: this.#timeoutMs, method, path }
        );
      }
      throw new InfrastructureError(
        `playback hub network error: ${method} ${path}: ${err.message}`,
        { code: 'HUB_NETWORK_ERROR', method, path, cause: err.message }
      );
    }

    // Parse body — defensively. Empty body for some error responses is fine.
    const text = typeof response.data === 'string' ? response.data : '';
    let parsed = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body — leave parsed as null; status decides next step.
      }
    }
    return { status: response.status, body: parsed };
  }
}

export default HttpPlaybackHubAdapter;
