import { timingSafeEqual } from 'node:crypto';
import { workHash, assertWorkUser } from '../domain/workState.mjs';
const ID = /^[1-9][0-9]*$/;
const revision = identity => identity.revision ?? workHash([identity.username, String(identity.senderId), identity.conversationId]);

/** Work request authority is independent of KB enablement and stored message text. */
export class WorkPrincipalAuthority {
  #identity;
  #secret;
  #clock;
  #trusted = new WeakSet();
  #closed = false;
  constructor({
    identityForSender,
    webhookSecret,
    clock = Date.now
  }) {
    if (typeof identityForSender !== 'function' || typeof clock !== 'function') throw new TypeError('Work identity providers required');
    this.#identity = identityForSender;
    this.#clock = clock;
    this.#secret = typeof webhookSecret === 'string' && webhookSecret.trim() ? Buffer.from(webhookSecret, 'utf8') : null;
  }
  capturePrincipal({
    event,
    webhookSecret,
    forwarded = false
  }) {
    if (this.#closed || forwarded || !this.#secret || typeof webhookSecret !== 'string') return null;
    const presented = Buffer.from(webhookSecret, 'utf8');
    if (presented.length !== this.#secret.length || !timingSafeEqual(presented, this.#secret)) return null;
    if (event?.platform !== 'telegram' || !['text', 'voice', 'command', 'callback'].includes(event.type)) return null;
    const {
      senderId,
      chatId,
      chatType,
      edited,
      editDate,
      updateId,
      replyToMessageId
    } = event.metadata ?? {};
    if (typeof senderId !== 'string' || !ID.test(senderId) || event.platformUserId !== senderId || chatId !== senderId || chatType !== 'private' || !ID.test(event.messageId ?? '')) return null;
    let identity;
    try {
      identity = this.#identity(senderId);
      assertWorkUser(identity?.username);
    } catch {
      return null;
    }
    if (!identity || String(identity.senderId) !== senderId || identity.conversationId !== event.conversationId) return null;
    const receivedAt = this.#clock();
    if (!Number.isFinite(receivedAt) || edited === true && (!Number.isSafeInteger(editDate) || editDate <= 0 || !Number.isSafeInteger(updateId) || updateId < 0)) return null;
    const {
      callbackId,
      callbackData
    } = event.payload ?? {};
    if (event.type === 'callback' && (typeof callbackId !== 'string' || !callbackId || callbackId.length > 128 || typeof callbackData !== 'string' || Buffer.byteLength(callbackData, 'utf8') > 64)) return null;
    const principal = Object.freeze({
      platform: 'telegram',
      kind: event.type,
      username: identity.username,
      senderId,
      conversationId: identity.conversationId,
      messageId: event.messageId,
      receiptId: event.type === 'callback' ? `${identity.conversationId}:callback:${callbackId}` : `${identity.conversationId}:message:${event.messageId}${edited === true ? ':edit:' + updateId : ''}`,
      callbackData: event.type === 'callback' ? callbackData : null,
      replyToMessageId: ID.test(replyToMessageId ?? '') ? replyToMessageId : null,
      authored: true,
      receivedAt,
      sourceRevision: revision(identity),
      edited: edited === true,
      ...(edited === true ? {
        editDate,
        updateId
      } : {})
    });
    this.#trusted.add(principal);
    return principal;
  }
  verify(principal) {
    if (this.#closed || !principal || !this.#trusted.has(principal) || !Object.isFrozen(principal)) return null;
    try {
      const identity = this.#identity(principal.senderId);
      return identity?.username === principal.username && String(identity.senderId) === principal.senderId && identity.conversationId === principal.conversationId && revision(identity) === principal.sourceRevision ? principal : null;
    } catch {
      return null;
    }
  }
  close() {
    this.#closed = true;
  }
}
