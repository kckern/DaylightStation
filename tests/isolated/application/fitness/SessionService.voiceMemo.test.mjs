/**
 * SessionService.appendVoiceMemo — sessionId sanitization tests
 *
 * appendVoiceMemo must sanitize the sessionId before forwarding to the store,
 * mirroring getSession. A `fs_`-prefixed id must be stripped to bare digits so
 * the datastore derives the correct dated path. Previously the raw prefixed id
 * was forwarded and the memo was silently lost.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionService } from '#apps/fitness/services/SessionService.mjs';

describe('SessionService.appendVoiceMemo — sanitization', () => {
  let service;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      appendVoiceMemo: vi.fn().mockResolvedValue({ transcript: 'hi' }),
    };
    service = new SessionService({
      sessionStore: mockStore,
      defaultHouseholdId: 'default-hid',
    });
  });

  it('forwards a bare sessionId unchanged', async () => {
    await service.appendVoiceMemo('20260601192802', 'test-hid', { transcriptClean: 'hi' });
    expect(mockStore.appendVoiceMemo).toHaveBeenCalledWith(
      '20260601192802',
      'test-hid',
      expect.any(Object)
    );
  });

  it('strips a fs_-prefixed sessionId to bare digits before forwarding (regression)', async () => {
    await service.appendVoiceMemo('fs_20260601192802', 'test-hid', { transcriptClean: 'hi' });
    expect(mockStore.appendVoiceMemo).toHaveBeenCalledWith(
      '20260601192802',
      'test-hid',
      expect.any(Object)
    );
  });

  it('returns null without calling the store for an invalid sessionId', async () => {
    const result = await service.appendVoiceMemo('123', 'test-hid', { transcriptClean: 'hi' });
    expect(result).toBeNull();
    expect(mockStore.appendVoiceMemo).not.toHaveBeenCalled();
  });
});
