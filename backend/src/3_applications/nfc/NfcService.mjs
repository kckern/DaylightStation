/**
 * NfcService — orchestrates a single NFC tag scan from API to dispatched action.
 * @module applications/nfc/NfcService
 */

import { randomUUID } from 'node:crypto';
import { resolveIntent } from '#domains/nfc/NfcIntent.mjs';
import { dispatchAction, UnknownActionError } from './actionHandlers.mjs';

export class NfcService {
  #config;
  #contentIdResolver;
  #deps;
  #broadcast;
  #logger;

  constructor({ config, contentIdResolver, wakeAndLoadService, haGateway, deviceService, broadcast, logger = console }) {
    this.#config = config || { readers: {}, tags: {} };
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
  }

  async handleScan(readerId, tagUid, options = {}) {
    const startedAt = Date.now();
    const dispatchId = randomUUID();
    const normalizedUid = String(tagUid || '').toLowerCase();
    const reader = this.#config.readers?.[readerId];

    if (!reader) {
      this.#logger.warn?.('nfc.scan', { readerId, tagUid: normalizedUid, registered: false, error: 'reader-not-found' });
      return { ok: false, code: 'READER_NOT_FOUND', error: `Unknown reader: ${readerId}`, readerId, tagUid: normalizedUid, dispatchId };
    }

    if (reader.auth_token && reader.auth_token !== options.token) {
      this.#logger.warn?.('nfc.scan', { readerId, tagUid: normalizedUid, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', readerId, tagUid: normalizedUid, dispatchId };
    }

    const tag = this.#config.tags?.[normalizedUid];
    const baseLog = { readerId, tagUid: normalizedUid, registered: !!tag, dispatchId };

    if (!tag) {
      this.#logger.info?.('nfc.scan', { ...baseLog, error: 'tag-not-registered' });
      this.#emit(readerId, baseLog);
      return { ok: false, code: 'TAG_NOT_REGISTERED', error: `Tag not registered: ${normalizedUid}`, readerId, tagUid: normalizedUid, dispatchId };
    }

    let intent;
    try {
      intent = resolveIntent(reader, tag, this.#contentIdResolver);
      intent.dispatchId = dispatchId;
    } catch (err) {
      this.#logger.error?.('nfc.scan', { ...baseLog, error: err.message });
      this.#emit(readerId, { ...baseLog, ok: false, error: err.message });
      return { ok: false, code: 'INVALID_INTENT', error: err.message, readerId, tagUid: normalizedUid, dispatchId };
    }

    const summary = { readerId, tagUid: normalizedUid, action: intent.action, target: intent.target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('nfc.scan', { ...baseLog, action: intent.action, target: intent.target, dryRun: true });
      this.#emit(readerId, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, intent };
    }

    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = Date.now() - startedAt;
      this.#logger.info?.('nfc.scan', { ...baseLog, action: intent.action, target: intent.target, ok: true, elapsedMs });
      this.#emit(readerId, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('nfc.scan', { ...baseLog, action: intent.action, target: intent.target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(readerId, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
  }

  #emit(readerId, payload) {
    this.#broadcast({ topic: `nfc:${readerId}`, type: 'nfc.scan', ...payload });
  }
}

export default NfcService;
