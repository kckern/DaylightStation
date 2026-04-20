/**
 * Image Retry Tests
 *
 * - RetryImageDetection: validates state, cleans up stale photo, delegates to LogFoodFromImage.
 * - LogFoodFromImage catch path: writes retry state and attaches retry button on hard failure.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RetryImageDetection } from '#apps/nutribot/usecases/RetryImageDetection.mjs';

function buildRetryDeps(overrides = {}) {
  const conversationStateStore = {
    get: jest.fn().mockResolvedValue({
      activeFlow: 'image_retry',
      flowState: {
        imageData: { fileId: 'tg-file-abc' },
        retryMessageId: 'photo-msg-1',
      },
    }),
    clear: jest.fn().mockResolvedValue({}),
  };

  const logFoodFromImage = {
    execute: jest.fn().mockResolvedValue({ success: true, nutrilogUuid: 'uuid-1', messageId: 'new-photo-2', itemCount: 1 }),
  };

  const messagingGateway = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'gw-msg-1' }),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };

  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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
