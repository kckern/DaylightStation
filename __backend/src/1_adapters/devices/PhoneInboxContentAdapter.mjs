/**
 * PhoneInboxContentAdapter — content control for a device that polls for its commands
 * (`content_control.provider: phone-inbox`; the household phone app).
 *
 * Builds the same `queue` CommandEnvelope a WebSocket screen receives and puts it in
 * the device's inbox (PhoneInboxService), where the phone's long-poll picks it up. A
 * phone that is not polling cannot be reached: load() then answers "not connected", so
 * the dispatch reads "not delivered" instead of "sent" (PR-10). There is nothing to
 * power on, prepare or prewarm.
 *
 * @module adapters/devices
 */

import { randomUUID } from 'node:crypto';
import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { decodeItemAction } from '#shared-contracts/media/item-action.mjs';
import { isLoadContentQueueOp } from '#shared-contracts/media/commands.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IContentControl } from '#apps/devices/ports/IContentControl.mjs';
import { CONTENT_ID_KEYS, resolveContentId } from '#apps/devices/ports/contentControlQuery.mjs';

export class PhoneInboxContentAdapter extends IContentControl {
  #deviceId;
  #inbox;
  #logger;
  #loads = 0;
  #errors = 0;

  /**
   * @param {{deviceId:string}} config
   * @param {{inbox:{enqueue:Function,isPresent:Function}, logger?:Object}} deps
   */
  constructor(config, deps = {}) {
    super();
    if (!config?.deviceId) {
      throw new InfrastructureError('PhoneInboxContentAdapter requires deviceId', { code: 'MISSING_CONFIG', field: 'deviceId' });
    }
    if (!deps.inbox) {
      throw new InfrastructureError('PhoneInboxContentAdapter requires inbox', { code: 'MISSING_DEPENDENCY', dependency: 'inbox' });
    }
    this.#deviceId = config.deviceId;
    this.#inbox = deps.inbox;
    this.#logger = deps.logger || console;
  }

  // eslint-disable-next-line no-unused-vars
  async prepareForContent(_options = {}) {
    return { ok: true };
  }

  // eslint-disable-next-line no-unused-vars
  async load(_path, query = {}, _options = {}) {
    this.#loads++;
    if (!this.#inbox.isPresent(this.#deviceId)) {
      this.#errors++;
      this.#logger.warn?.('phone-inbox.load.not-polling', { deviceId: this.#deviceId });
      return { ok: false, error: 'Phone not connected (not polling)' };
    }
    const resolved = resolveContentId(query);
    if (!resolved) {
      this.#errors++;
      return { ok: false, error: `PhoneInboxContentAdapter.load: no contentId in ${CONTENT_ID_KEYS.join(', ')}` };
    }
    const { contentId, resolvedKey } = resolved;
    const op = isLoadContentQueueOp(query.op) ? query.op : 'play-now';
    const options = { ...query };
    delete options[resolvedKey];
    delete options.op;
    delete options.dispatchId;
    const commandId = typeof query.dispatchId === 'string' && query.dispatchId ? query.dispatchId : randomUUID();
    const envelope = buildCommandEnvelope({
      targetDevice: this.#deviceId,
      command: 'queue',
      commandId,
      params: decodeItemAction(query.itemAction) ?? { ...options, op, contentId },
    });
    this.#inbox.enqueue(this.#deviceId, envelope);
    this.#logger.info?.('phone-inbox.load', { deviceId: this.#deviceId, commandId, contentId, op });
    return { ok: true, method: 'phone-inbox', commandId };
  }

  /** The phone streams from the backend itself: a transcode prewarm would go unused. */
  wantsPrewarm() { return false; }

  async getStatus() {
    const present = this.#inbox.isPresent(this.#deviceId);
    return { ready: present, provider: 'phone-inbox', polling: present };
  }

  getMetrics() {
    return { provider: 'phone-inbox', deviceId: this.#deviceId, loads: this.#loads, errors: this.#errors };
  }
}

export default PhoneInboxContentAdapter;
