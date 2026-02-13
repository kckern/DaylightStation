import { describe, it, expect } from '@jest/globals';
import { ResolvedIdentity } from '#domains/messaging/value-objects/ResolvedIdentity.mjs';
import { ConversationId } from '#domains/messaging/value-objects/ConversationId.mjs';

describe('ResolvedIdentity', () => {
  const conversationId = new ConversationId('telegram', 'b123_c456');

  it('creates with username and conversationId', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(identity.username).toBe('kckern');
    expect(identity.conversationId).toBe(conversationId);
  });

  it('allows null username (unknown user)', () => {
    const identity = new ResolvedIdentity({ username: null, conversationId });

    expect(identity.username).toBeNull();
    expect(identity.conversationId).toBe(conversationId);
  });

  it('requires conversationId', () => {
    expect(() => new ResolvedIdentity({ username: 'kckern' }))
      .toThrow('conversationId is required');
  });

  it('is immutable', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('converts conversationId to string', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(identity.conversationIdString).toBe('telegram:b123_c456');
  });
});
