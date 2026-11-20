import { timingSafeEqual } from 'node:crypto';
import { workHash, assertWorkUser } from '../domain/workState.mjs';
const ID = /^[1-9][0-9]*$/;
const revision = identity => identity.revision ?? workHash([identity.username, String(identity.senderId), identity.conversationId]);
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Unattended jobs allowed to act as a user. Each may only complete tasks (WorkCommands). */
export const SYSTEM_JOBS = Object.freeze(['triage-overnight']);

/** Work request authority is independent of KB enablement and stored message text. */
export class WorkPrincipalAuthority {
  #identity;
  #secret;
  #clock;
  #isActiveSession;
  #isEnrolled;
  #logger;
  #sequence = 0;
  #trusted = new WeakSet();
  #closed = false;
  constructor({
    identityForSender,
    webhookSecret,
    clock = Date.now,
    isActiveSession = null,
    isEnrolled = null,
    logger = null
  }) {
    if (typeof identityForSender !== 'function' || typeof clock !== 'function') throw new TypeError('Work identity providers required');
    this.#identity = identityForSender;
    this.#clock = clock;
    // Both optional: without them web/system principals are never produced (fail closed).
    this.#isActiveSession = typeof isActiveSession === 'function' ? isActiveSession : null;
    this.#isEnrolled = typeof isEnrolled === 'function' ? isEnrolled : null;
    this.#logger = logger;
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
  #enrolled(username) {
    try {
      assertWorkUser(username);
      return this.#isEnrolled?.(username) === true;
    } catch {
      return false;
    }
  }
  #sessionLive(sid, username) {
    try {
      // `username` is passed so the host can also bind the session to its owner.
      return this.#isActiveSession?.(sid, username) === true;
    } catch {
      return false;
    }
  }
  /**
   * The owner's own login session. The tap that sends the request is the owner's
   * confirmation, but a write still needs a `confirmWeb` grant (WorkDecisions).
   */
  captureWebPrincipal({
    session,
    requestId
  } = {}) {
    const reject = reason => {
      this.#logger?.warn?.('work.principal.web.rejected', {
        reason
      });
      return null;
    };
    if (this.#closed) return reject('closed');
    if (!this.#isActiveSession || !this.#isEnrolled) return reject('unavailable');
    const {
      username,
      sid
    } = session ?? {};
    if (typeof sid !== 'string' || !sid || sid.length > 256 || typeof requestId !== 'string' || !OPAQUE.test(requestId)) return reject('invalid_request');
    if (!this.#enrolled(username)) return reject('not_enrolled');
    if (!this.#sessionLive(sid, username)) return reject('session_inactive');
    const receivedAt = this.#clock();
    if (!Number.isFinite(receivedAt)) return reject('invalid_clock');
    const principal = Object.freeze({
      platform: 'web',
      kind: 'session',
      username,
      sessionId: sid,
      receiptId: `web:${requestId}`,
      authored: true,
      receivedAt
    });
    this.#trusted.add(principal);
    this.#logger?.info?.('work.principal.web.captured', {
      username
    });
    return principal;
  }
  /** An unattended job acting for a user; not authored, and limited to `complete` downstream. */
  captureSystemPrincipal({
    username,
    job
  } = {}) {
    const reject = reason => {
      this.#logger?.warn?.('work.principal.system.rejected', {
        reason,
        job: typeof job === 'string' ? job.slice(0, 64) : null
      });
      return null;
    };
    if (this.#closed) return reject('closed');
    if (!this.#isEnrolled) return reject('unavailable');
    if (!SYSTEM_JOBS.includes(job)) return reject('unknown_job');
    if (!this.#enrolled(username)) return reject('not_enrolled');
    const receivedAt = this.#clock();
    if (!Number.isFinite(receivedAt)) return reject('invalid_clock');
    const principal = Object.freeze({
      platform: 'system',
      kind: 'job',
      job,
      username,
      receiptId: `system:${job}:${receivedAt}:${++this.#sequence}`,
      authored: false,
      receivedAt
    });
    this.#trusted.add(principal);
    this.#logger?.info?.('work.principal.system.captured', {
      username,
      job
    });
    return principal;
  }
  web(input) {
    return this.captureWebPrincipal(input);
  }
  system(input) {
    return this.captureSystemPrincipal(input);
  }
  verify(principal) {
    if (this.#closed || !principal || !this.#trusted.has(principal) || !Object.isFrozen(principal)) return null;
    // Re-checked on every use, so a revoked session or an unenrolled user stops mid-flow.
    if (principal.platform === 'web') return principal.authored === true && this.#enrolled(principal.username) && this.#sessionLive(principal.sessionId, principal.username) ? principal : null;
    if (principal.platform === 'system') return principal.authored === false && SYSTEM_JOBS.includes(principal.job) && this.#enrolled(principal.username) ? principal : null;
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
