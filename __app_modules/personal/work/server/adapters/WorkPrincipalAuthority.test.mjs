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
