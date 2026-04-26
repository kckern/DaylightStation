/**
 * Revision Flow Short-Circuit Tests
 *
 * Verifies that LogFoodFromText short-circuits in revision mode:
 * - No new status messages created
 * - Updates the ORIGINAL message with revised items
 * - Clears conversation state
 * - Deletes the user's revision text message
 * - Calls AI once with revision-aware prompt
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';
import { ProcessRevisionInput } from '../../../backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs';

// Doubled-items AI response for "Double the recipe"
const DOUBLED_AI_RESPONSE = JSON.stringify({
  date: '2026-03-22',
  time: 'morning',
  items: [
    {
      name: 'Green Peas',
      icon: 'peas',
      noom_color: 'green',
      quantity: 1,
      unit: 'g',
      grams: 480,
      calories: 400,
      protein: 26,
      carbs: 72,
      fat: 2,
      fiber: 0,
      sugar: 0,
      sodium: 0,
      cholesterol: 0,
    },
  ],
});

function buildExistingLog() {
  return {
    id: 'log-uuid-123',
    status: 'pending',
    items: [
      {
        id: 'item-1',
        label: 'Green Peas',
        grams: 240,
        calories: 200,
        protein: 13,
        carbs: 36,
        fat: 1,
        unit: 'g',
        amount: 240,
        color: 'green',
        icon: 'peas',
        fiber: 0,
        sugar: 0,
        sodium: 0,
        cholesterol: 0,
      },
    ],
    meal: { date: '2026-03-22', time: 'morning' },
    metadata: { source: 'text' },
    date: '2026-03-22',
    updateItems(items, ts) {
      return {
        ...this,
        items,
        updatedAt: ts,
        updateDate: this.updateDate.bind({ ...this, items }),
      };
    },
    updateDate(date, time, ts) {
      return { ...this, meal: { ...this.meal, date }, date, updatedAt: ts };
    },
  };
}

function buildDeps(overrides = {}) {
  const messagingGateway = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'new-msg-1' }),
    updateMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
  };

  const aiGateway = {
    chat: vi.fn().mockResolvedValue(DOUBLED_AI_RESPONSE),
  };

  const foodLogStore = {
    findByUuid: vi.fn().mockResolvedValue(buildExistingLog()),
    save: vi.fn().mockResolvedValue({}),
  };

  const conversationStateStore = {
    get: vi.fn().mockResolvedValue({
      activeFlow: 'revision',
      flowState: {
        pendingLogUuid: 'log-uuid-123',
        originalMessageId: 'orig-msg-42',
      },
    }),
    clear: vi.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    updateMessage: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
    createStatusIndicator: vi.fn().mockResolvedValue({
      messageId: 'status-msg-1',
      finish: vi.fn().mockResolvedValue({}),
    }),
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
    config: { getDefaultTimezone: () => 'America/Los_Angeles', getUserTimezone: () => 'America/Los_Angeles' },
    encodeCallback: (cmd, data) => JSON.stringify({ cmd, ...data }),
    ...overrides,
  };
}

describe('LogFoodFromText — revision short-circuit', () => {
  let deps;
  let useCase;

  beforeEach(() => {
    deps = buildDeps();
    useCase = new LogFoodFromText(deps);
  });

  it('should NOT create new status message when in revision mode', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    expect(result.success).toBe(true);
    expect(result.revised).toBe(true);

    // createStatusIndicator should NOT have been called
    expect(deps.responseContext.createStatusIndicator).not.toHaveBeenCalled();
    // sendMessage should NOT have been called (no new messages)
    expect(deps.responseContext.sendMessage).not.toHaveBeenCalled();
  });

  it('should update the ORIGINAL message with revised items', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    // updateMessage should be called with the original message ID
    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    // Find the final update (with choices/buttons)
    const finalUpdate = updateCalls.find(
      ([msgId, payload]) => msgId === 'orig-msg-42' && payload.choices
    );
    expect(finalUpdate).toBeTruthy();
    expect(finalUpdate[0]).toBe('orig-msg-42');
    expect(finalUpdate[1].choices).toBeDefined();
    expect(finalUpdate[1].inline).toBe(true);
  });

  it('should clear conversation state after successful revision', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    expect(deps.conversationStateStore.clear).toHaveBeenCalledWith('conv-1');
  });

  it('should delete the user revision text message', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    expect(deps.responseContext.deleteMessage).toHaveBeenCalledWith('user-msg-99');
  });

  it('should call AI exactly once with revision-aware prompt including original items', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    expect(deps.aiGateway.chat).toHaveBeenCalledTimes(1);

    const [prompt] = deps.aiGateway.chat.mock.calls[0];
    // The user content should include original item names in the contextual text
    const userContent = prompt.find((m) => m.role === 'user')?.content || '';
    expect(userContent).toContain('Green Peas');
  });

  it('should send error message when log is not found (stale state)', async () => {
    deps.foodLogStore.findByUuid.mockResolvedValue(null);
    useCase = new LogFoodFromText(deps);

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
    expect(deps.responseContext.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('expired'),
      expect.any(Object)
    );
    // Should NOT create status messages or call AI
    expect(deps.responseContext.createStatusIndicator).not.toHaveBeenCalled();
  });

  it('should handle image-based logs by using caption instead of text', async () => {
    const imageLog = buildExistingLog();
    imageLog.metadata = { source: 'image' };
    deps.foodLogStore.findByUuid.mockResolvedValue(imageLog);
    useCase = new LogFoodFromText(deps);

    await useCase.execute({
      userId: 'user-1',
      conversationId: 'conv-1',
      text: 'Double the recipe',
      messageId: 'user-msg-99',
      responseContext: deps.responseContext,
    });

    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const finalUpdate = updateCalls.find(
      ([msgId, payload]) => msgId === 'orig-msg-42' && payload.choices
    );
    expect(finalUpdate).toBeTruthy();
    expect(finalUpdate[1].caption).toBeDefined();
    expect(finalUpdate[1].text).toBeUndefined();
  });

  it('should restore original message and NOT delete user message when AI call fails', async () => {
    deps.aiGateway.chat.mockRejectedValue(new Error('Network timeout'));
    useCase = new LogFoodFromText(deps);

    await expect(
      useCase.execute({
        userId: 'user-1',
        conversationId: 'conv-1',
        text: 'Double the recipe',
        messageId: 'user-msg-99',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('Network timeout');

    // Original message should be restored with buttons so user can retry
    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const restoreCall = updateCalls.find(
      ([msgId, payload]) => msgId === 'orig-msg-42' && payload.choices
    );
    expect(restoreCall).toBeTruthy();

    // User's revision message should NOT be deleted — they can see their input and retry
    expect(deps.responseContext.deleteMessage).not.toHaveBeenCalled();

    // Conversation state should NOT be cleared — user can still retry
    expect(deps.conversationStateStore.clear).not.toHaveBeenCalled();
  });
});

describe('ProcessRevisionInput — responseContext', () => {
  it('should use responseContext for message operations when available', async () => {
    const mockResponseContext = {
      updateMessage: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'msg' }),
    };

    const mockGateway = {
      sendMessage: vi.fn(),
      updateMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };

    const mockStateStore = {
      get: vi.fn().mockResolvedValue({
        activeFlow: 'revision',
        flowState: { pendingLogUuid: 'log-1', originalMessageId: 'orig-msg' },
      }),
      set: vi.fn().mockResolvedValue({}),
      clear: vi.fn().mockResolvedValue({}),
    };

    const mockAi = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        items: [{ name: 'Doubled Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 480, calories: 400, protein: 26, carbs: 72, fat: 2 }],
      })),
    };

    const mockLogStore = {
      findByUuid: vi.fn().mockResolvedValue({
        id: 'log-1',
        items: [{ label: 'Peas', grams: 240, calories: 200, protein: 13, carbs: 36, fat: 1 }],
        meal: { date: '2026-03-22' },
        metadata: { source: 'text' },
      }),
      updateItems: vi.fn().mockResolvedValue({}),
    };

    const useCase = new ProcessRevisionInput({
      messagingGateway: mockGateway,
      aiGateway: mockAi,
      foodLogStore: mockLogStore,
      conversationStateStore: mockStateStore,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:bot_user',
      text: 'Double the recipe.',
      messageId: 'user-msg',
      responseContext: mockResponseContext,
    });

    // responseContext should be used, NOT messagingGateway
    expect(mockResponseContext.deleteMessage).toHaveBeenCalledWith('user-msg');
    expect(mockResponseContext.updateMessage).toHaveBeenCalled();
    expect(mockGateway.deleteMessage).not.toHaveBeenCalled();
    expect(mockGateway.updateMessage).not.toHaveBeenCalled();
  });
});
