import { describe, it, expect } from 'vitest';
import { WorkPrincipalAuthority } from './WorkPrincipalAuthority.mjs';
const secret = 'fixture-work-webhook';
const event = (patch = {}) => ({
  platform: 'telegram',
  platformUserId: '101',
  conversationId: 'telegram:b42_c101',
  type: 'text',
  messageId: '99',
  metadata: {
    senderId: '101',
    chatId: '101',
    chatType: 'private'
  },
  payload: {
    text: 'I finished the task.'
  },
  ...patch
});
const identity = {
  username: 'sample',
  senderId: '101',
  conversationId: 'telegram:b42_c101',
  revision: 'identity-v1'
};
describe('independent Work principal', () => {
  it('brands an immutable private request without a KB dependency', () => {
    const authority = new WorkPrincipalAuthority({
      identityForSender: id => id === '101' ? identity : null,
      webhookSecret: secret,
      clock: () => 1000
    });
    const principal = authority.capturePrincipal({
      event: event(),
      webhookSecret: secret
    });
    expect(authority.verify(principal)).toBe(principal);
    expect(principal).toMatchObject({
      username: 'sample',
      messageId: '99',
      authored: true,
      sourceRevision: 'identity-v1'
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(authority.verify(structuredClone(principal))).toBeNull();
  });
  it('rejects bad secret, group, wrong bot/conversation, invalid edit and forwarded source', () => {
    const authority = new WorkPrincipalAuthority({
      identityForSender: () => identity,
      webhookSecret: secret,
      clock: () => 1000
    });
    expect(authority.capturePrincipal({
      event: event(),
      webhookSecret: 'wrong'
    })).toBeNull();
    expect(authority.capturePrincipal({
      event: event({
        conversationId: 'telegram:b99_c101'
      }),
      webhookSecret: secret
    })).toBeNull();
    expect(authority.capturePrincipal({
      event: event({
        metadata: {
          senderId: '101',
          chatId: '-1',
          chatType: 'group'
        }
      }),
      webhookSecret: secret
    })).toBeNull();
    expect(authority.capturePrincipal({
      event: event({
        metadata: {
          ...event().metadata,
          edited: true
        }
      }),
      webhookSecret: secret
    })).toBeNull();
    expect(authority.capturePrincipal({
      event: event(),
      webhookSecret: secret,
      forwarded: true
    })).toBeNull();
  });
  it('invalidates a captured principal when identity revision changes or authority closes', () => {
    let current = {
      ...identity
    };
    const authority = new WorkPrincipalAuthority({
      identityForSender: () => current,
      webhookSecret: secret,
      clock: () => 1000
    });
    const principal = authority.capturePrincipal({
      event: event(),
      webhookSecret: secret
    });
    current = {
      ...identity,
      revision: 'identity-v2'
    };
    expect(authority.verify(principal)).toBeNull();
    authority.close();
    expect(authority.capturePrincipal({
      event: event(),
      webhookSecret: secret
    })).toBeNull();
  });
  it('binds callbacks to their actual ID and payload, limiting UTF8 bytes', () => {
    const authority = new WorkPrincipalAuthority({
      identityForSender: () => identity,
      webhookSecret: secret,
      clock: () => 1000
    });
    const input = event({
      type: 'callback',
      payload: {
        callbackId: 'callback-1',
        callbackData: 'work:opaque'
      }
    });
    const principal = authority.capturePrincipal({
      event: input,
      webhookSecret: secret
    });
    expect(principal).toMatchObject({
      callbackData: 'work:opaque',
      receiptId: 'telegram:b42_c101:callback:callback-1'
    });
    input.payload.callbackData = 'work:changed';
    expect(principal.callbackData).toBe('work:opaque');
    expect(authority.capturePrincipal({
      event: event({
        type: 'callback',
        payload: {
          callbackId: 'c2',
          callbackData: '🙂'.repeat(17)
        }
      }),
      webhookSecret: secret
    })).toBeNull();
  });
});
describe('web and system principals', () => {
  const make = (patch = {}) => {
    const sessions = new Set(['sid-live']);
    const enrolled = new Set(['sample']);
    const authority = new WorkPrincipalAuthority({
      identityForSender: () => identity,
      webhookSecret: secret,
      clock: () => 1000,
      isActiveSession: sid => sessions.has(sid),
      isEnrolled: username => enrolled.has(username),
      ...patch
    });
    return {
      authority,
      sessions,
      enrolled
    };
  };
  it('captures a web principal for an active session of an enrolled user', () => {
    const {
      authority
    } = make();
    const principal = authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 'sid-live'
      },
      requestId: 'req-1'
    });
    expect(principal).toEqual({
      platform: 'web',
      kind: 'session',
      username: 'sample',
      sessionId: 'sid-live',
      receiptId: 'web:req-1',
      authored: true,
      receivedAt: 1000
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(authority.verify(principal)).toBe(principal);
    expect(authority.web({
      session: {
        username: 'sample',
        sid: 'sid-live'
      },
      requestId: 'req-2'
    })).toMatchObject({
      platform: 'web'
    });
    expect(authority.verify(structuredClone(principal))).toBeNull();
  });
  it('returns null for an inactive session', () => {
    const {
      authority
    } = make();
    expect(authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 'sid-revoked'
      },
      requestId: 'req-1'
    })).toBeNull();
  });
  it('returns null for an un-enrolled user', () => {
    const {
      authority
    } = make();
    expect(authority.captureWebPrincipal({
      session: {
        username: 'other',
        sid: 'sid-live'
      },
      requestId: 'req-1'
    })).toBeNull();
  });
  it('never produces web principals without a session checker (fail closed)', () => {
    const {
      authority
    } = make({
      isActiveSession: undefined
    });
    expect(authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 'sid-live'
      },
      requestId: 'req-1'
    })).toBeNull();
  });
  it('passes the username to the session checker and rejects a session that throws or is async', () => {
    const seen = [];
    expect(make({
      isActiveSession: (sid, username) => {
        seen.push([sid, username]);
        return true;
      }
    }).authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 's1'
      },
      requestId: 'r'
    })).not.toBeNull();
    expect(seen).toEqual([['s1', 'sample']]);
    expect(make({
      isActiveSession: async () => true
    }).authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 's1'
      },
      requestId: 'r'
    })).toBeNull();
    expect(make({
      isActiveSession: () => {
        throw new Error('x');
      }
    }).authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 's1'
      },
      requestId: 'r'
    })).toBeNull();
  });
  it('stops verifying a web principal once its session is revoked or the user unenrolled', () => {
    const {
      authority,
      sessions,
      enrolled
    } = make();
    const principal = authority.captureWebPrincipal({
      session: {
        username: 'sample',
        sid: 'sid-live'
      },
      requestId: 'req-1'
    });
    sessions.delete('sid-live');
    expect(authority.verify(principal)).toBeNull();
    sessions.add('sid-live');
    expect(authority.verify(principal)).toBe(principal);
    enrolled.delete('sample');
    expect(authority.verify(principal)).toBeNull();
  });
  it('captures a system principal only for a known job and an enrolled user', () => {
    const {
      authority
    } = make();
    expect(authority.captureSystemPrincipal({
      username: 'sample',
      job: 'other'
    })).toBeNull();
    expect(authority.captureSystemPrincipal({
      username: 'other',
      job: 'triage-overnight'
    })).toBeNull();
    const principal = authority.system({
      username: 'sample',
      job: 'triage-overnight'
    });
    expect(principal).toMatchObject({
      platform: 'system',
      kind: 'job',
      job: 'triage-overnight',
      username: 'sample',
      authored: false,
      receivedAt: 1000
    });
    expect(typeof principal.receiptId).toBe('string');
    expect(authority.verify(principal)).toBe(principal);
    expect(authority.system({
      username: 'sample',
      job: 'triage-overnight'
    }).receiptId).not.toBe(principal.receiptId);
    authority.close();
    expect(authority.verify(principal)).toBeNull();
  });
  it('a web principal never verifies as Telegram and a Telegram principal is unchanged', () => {
    const {
      authority
    } = make();
    const telegram = authority.capturePrincipal({
      event: event(),
      webhookSecret: secret
    });
    expect(authority.verify(telegram)).toBe(telegram);
    expect(telegram.platform).toBe('telegram');
  });
});
