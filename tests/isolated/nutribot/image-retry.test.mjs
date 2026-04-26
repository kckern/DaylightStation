/**
 * Image Retry Tests
 *
 * - RetryImageDetection: validates state, cleans up stale photo, delegates to LogFoodFromImage.
 * - LogFoodFromImage catch path: writes retry state and attaches retry button on hard failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryImageDetection } from '#apps/nutribot/usecases/RetryImageDetection.mjs';

function buildRetryDeps(overrides = {}) {
  const conversationStateStore = {
    get: vi.fn().mockResolvedValue({
      activeFlow: 'image_retry',
      flowState: {
        imageData: { fileId: 'tg-file-abc' },
        retryMessageId: 'photo-msg-1',
      },
    }),
    clear: vi.fn().mockResolvedValue({}),
  };

  const logFoodFromImage = {
    execute: vi.fn().mockResolvedValue({ success: true, nutrilogUuid: 'uuid-1', messageId: 'new-photo-2', itemCount: 1 }),
  };

  const messagingGateway = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'gw-msg-1' }),
    deleteMessage: vi.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    deleteMessage: vi.fn().mockResolvedValue({}),
  };

  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    conversationStateStore,
    logFoodFromImage,
    messagingGateway,
    responseContext,
    logger,
    ...overrides,
  };
}

describe('RetryImageDetection', () => {
  let deps;
  let useCase;

  beforeEach(() => {
    deps = buildRetryDeps();
    useCase = new RetryImageDetection(deps);
  });

  it('reads state, clears it, deletes old photo, and delegates to LogFoodFromImage', async () => {
    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(deps.conversationStateStore.clear).toHaveBeenCalledWith('telegram:conv-1');
    expect(deps.responseContext.deleteMessage).toHaveBeenCalledWith('photo-msg-1');

    const clearOrder = deps.conversationStateStore.clear.mock.invocationCallOrder[0];
    const deleteOrder = deps.responseContext.deleteMessage.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(deleteOrder);

    expect(deps.logFoodFromImage.execute).toHaveBeenCalledTimes(1);
    const [input] = deps.logFoodFromImage.execute.mock.calls[0];
    expect(input.imageData).toEqual({ fileId: 'tg-file-abc' });
    expect(input.conversationId).toBe('telegram:conv-1');
    expect(input.userId).toBe('kckern');
    expect(input.messageId).toBeNull();
    expect(input.responseContext).toBe(deps.responseContext);

    expect(result).toEqual({ success: true, nutrilogUuid: 'uuid-1', messageId: 'new-photo-2', itemCount: 1 });
  });

  it('returns stale when state is missing', async () => {
    deps.conversationStateStore.get.mockResolvedValue(null);
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.responseContext.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer available')
    );
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
    expect(deps.conversationStateStore.clear).not.toHaveBeenCalled();
  });

  it('returns stale when activeFlow is not image_retry', async () => {
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { imageData: { fileId: 'anything' } },
    });
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
  });

  it('returns stale when imageData.fileId is missing', async () => {
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'image_retry',
      flowState: { retryMessageId: 'photo-msg-1' },
    });
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
  });

  it('proceeds when delete of old photo fails', async () => {
    deps.responseContext.deleteMessage.mockRejectedValue(new Error('Message to delete not found'));
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(deps.logFoodFromImage.execute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(deps.logger.debug).toHaveBeenCalledWith(
      'retryImage.deleteOldPhoto.failed',
      expect.any(Object)
    );
  });

  it('falls back to messagingGateway.sendMessage for stale when no responseContext', async () => {
    deps.conversationStateStore.get.mockResolvedValue(null);
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: null,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.messagingGateway.sendMessage).toHaveBeenCalledWith(
      'telegram:conv-1',
      expect.stringContaining('no longer available')
    );
  });

  it('throws during construction if required deps are missing', () => {
    expect(() => new RetryImageDetection({ logFoodFromImage: {} })).toThrow(/conversationStateStore/);
    expect(() => new RetryImageDetection({ conversationStateStore: {} })).toThrow(/logFoodFromImage/);
  });
});

import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';

function buildImageDeps(overrides = {}) {
  const messagingGateway = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'gw-msg-1' }),
    sendPhoto: vi.fn().mockResolvedValue({ messageId: 'photo-msg-1' }),
    updateMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
    getFileUrl: vi.fn().mockResolvedValue(null), // force use of fileId fallback
  };

  const aiGateway = {
    chatWithImage: vi.fn().mockRejectedValue(new Error('getaddrinfo EAI_AGAIN api.openai.com')),
  };

  const foodLogStore = {
    findByUuid: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({}),
  };

  const conversationStateStore = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue({}),
    clear: vi.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    sendPhoto: vi.fn().mockResolvedValue({ messageId: 'photo-msg-1' }),
    updateMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
    getFileUrl: vi.fn().mockResolvedValue(null),
  };

  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    messagingGateway,
    aiGateway,
    foodLogStore,
    conversationStateStore,
    responseContext,
    logger,
    config: { getDefaultTimezone: () => 'America/Los_Angeles' },
    encodeCallback: (cmd, data) => JSON.stringify({ cmd, ...data }),
    foodIconsString: 'apple banana default',
    ...overrides,
  };
}

describe('LogFoodFromImage — retry button on failure', () => {
  let deps;
  let useCase;

  beforeEach(() => {
    deps = buildImageDeps();
    useCase = new LogFoodFromImage(deps);
  });

  it('writes retry state and attaches retry button when AI call fails', async () => {
    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    expect(deps.conversationStateStore.set).toHaveBeenCalledWith(
      'telegram:conv-1',
      expect.objectContaining({
        activeFlow: 'image_retry',
        flowState: expect.objectContaining({
          imageData: expect.objectContaining({ fileId: 'tg-file-abc' }),
          retryMessageId: 'photo-msg-1',
        }),
      })
    );

    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const errorUpdate = updateCalls.find(([msgId, payload]) => msgId === 'photo-msg-1' && payload.choices);
    expect(errorUpdate).toBeTruthy();

    const [, payload] = errorUpdate;
    expect(payload.caption).toMatch(/Retry/);
    expect(payload.inline).toBe(true);
    expect(payload.choices).toEqual([
      [expect.objectContaining({ text: '🔄 Retry', callback_data: expect.any(String) })],
    ]);

    const decoded = JSON.parse(payload.choices[0][0].callback_data);
    expect(decoded).toEqual({ cmd: 'ir' });
  });

  it('falls back to button-less caption when state write fails', async () => {
    deps.conversationStateStore.set.mockRejectedValue(new Error('redis down'));
    useCase = new LogFoodFromImage(deps);

    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const errorUpdate = updateCalls.find(([msgId]) => msgId === 'photo-msg-1');
    expect(errorUpdate).toBeTruthy();
    expect(errorUpdate[1].choices).toBeUndefined();
    expect(errorUpdate[1].caption).toMatch(/trouble analyzing/);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'logImage.retryState.failed',
      expect.any(Object)
    );
  });

  it('does not write state or update caption when sendPhoto fails before photoMsgId exists', async () => {
    deps.responseContext.sendPhoto.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN api.telegram.org'));
    useCase = new LogFoodFromImage(deps);

    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    expect(deps.conversationStateStore.set).not.toHaveBeenCalled();
    expect(deps.responseContext.updateMessage).not.toHaveBeenCalled();
  });
});
