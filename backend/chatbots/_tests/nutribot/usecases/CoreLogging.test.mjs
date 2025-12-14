/**
 * NutriBot Core Logging Use Cases Tests
 * @module _tests/nutribot/usecases/CoreLogging.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { LogFoodFromImage } from '../../../nutribot/application/usecases/LogFoodFromImage.mjs';
import { LogFoodFromText } from '../../../nutribot/application/usecases/LogFoodFromText.mjs';
import { LogFoodFromVoice } from '../../../nutribot/application/usecases/LogFoodFromVoice.mjs';
import { LogFoodFromUPC } from '../../../nutribot/application/usecases/LogFoodFromUPC.mjs';
import { AcceptFoodLog } from '../../../nutribot/application/usecases/AcceptFoodLog.mjs';
import { DiscardFoodLog } from '../../../nutribot/application/usecases/DiscardFoodLog.mjs';
import { ReviseFoodLog } from '../../../nutribot/application/usecases/ReviseFoodLog.mjs';
import { ProcessRevisionInput } from '../../../nutribot/application/usecases/ProcessRevisionInput.mjs';
import { SelectUPCPortion } from '../../../nutribot/application/usecases/SelectUPCPortion.mjs';

// Status constants matching domain schema
const NutriLogStatus = {
  INIT: 'pending',
  PENDING: 'pending',
  CONFIRMED: 'accepted',
  DISCARDED: 'rejected',
};

// ==================== Mock Factories ====================

function createMockMessagingGateway() {
  return {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
    sendPhoto: jest.fn().mockResolvedValue({ messageId: 'msg-2' }),
    getFileUrl: jest.fn().mockResolvedValue('https://example.com/image.jpg'),
    transcribeVoice: jest.fn().mockResolvedValue('I had a chicken salad'),
  };
}

function createMockAIGateway(response = null) {
  const defaultResponse = JSON.stringify({
    items: [
      { name: 'Chicken Breast', quantity: 1, unit: 'piece', grams: 150, calories: 250, protein: 40, carbs: 0, fat: 8 },
      { name: 'Mixed Salad', quantity: 1, unit: 'cup', grams: 100, calories: 30, protein: 2, carbs: 5, fat: 0 },
    ]
  });

  return {
    chat: jest.fn().mockResolvedValue(response || defaultResponse),
    chatWithImage: jest.fn().mockResolvedValue(response || defaultResponse),
  };
}

function createMockNutrilogRepository() {
  const logs = new Map();
  return {
    save: jest.fn().mockImplementation(async (log) => {
      logs.set(log.uuid, log);
    }),
    findByUuid: jest.fn().mockImplementation(async (uuid) => {
      return logs.get(uuid) || null;
    }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    updateItems: jest.fn().mockResolvedValue(undefined),
    _logs: logs,
  };
}

function createMockNutrilistRepository() {
  return {
    saveMany: jest.fn().mockResolvedValue(undefined),
    findByDate: jest.fn().mockResolvedValue([]),
  };
}

function createMockConversationStateStore() {
  const states = new Map();
  return {
    get: jest.fn().mockImplementation(async (id) => states.get(id)),
    set: jest.fn().mockImplementation(async (id, state) => states.set(id, state)),
    delete: jest.fn().mockImplementation(async (id) => states.delete(id)),
    _states: states,
  };
}

function createMockUPCGateway() {
  return {
    lookup: jest.fn().mockResolvedValue({
      upc: '012345678901',
      name: 'Protein Bar',
      brand: 'FitFood',
      imageUrl: 'https://example.com/bar.jpg',
      nutrition: { calories: 200, protein: 20, carbs: 25, fat: 8 },
      serving: { size: 60, unit: 'g' },
    }),
  };
}

// ==================== LogFoodFromImage Tests ====================

describe('LogFoodFromImage', () => {
  let useCase;
  let messagingGateway;
  let aiGateway;
  let nutrilogRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    aiGateway = createMockAIGateway();
    nutrilogRepository = createMockNutrilogRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new LogFoodFromImage({
      messagingGateway,
      aiGateway,
      nutrilogRepository,
      conversationStateStore,
    });
  });

  it('should create NutriLog from image', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      imageData: { fileId: 'file-123' },
      messageId: 'orig-msg',
    });

    expect(result.success).toBe(true);
    expect(result.nutrilogUuid).toBeDefined();
    expect(result.itemCount).toBe(2);
    expect(aiGateway.chatWithImage).toHaveBeenCalled();
    expect(nutrilogRepository.save).toHaveBeenCalled();
  });

  it('should delete original message', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      imageData: { fileId: 'file-123' },
      messageId: 'orig-msg',
    });

    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith('chat-1', 'orig-msg');
  });

  it('should show action buttons', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      imageData: { fileId: 'file-123' },
    });

    const updateCall = messagingGateway.updateMessage.mock.calls[0];
    expect(updateCall[2].choices).toBeDefined();
    expect(updateCall[2].inline).toBe(true);
  });

  it('should handle empty detection', async () => {
    aiGateway.chatWithImage.mockResolvedValue('{}');

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      imageData: { fileId: 'file-123' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No food detected');
  });
});

// ==================== LogFoodFromText Tests ====================

describe('LogFoodFromText', () => {
  let useCase;
  let messagingGateway;
  let aiGateway;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    aiGateway = createMockAIGateway();

    useCase = new LogFoodFromText({
      messagingGateway,
      aiGateway,
    });
  });

  it('should create NutriLog from text', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      text: 'I had a chicken salad for lunch',
    });

    expect(result.success).toBe(true);
    expect(result.itemCount).toBe(2);
    expect(aiGateway.chat).toHaveBeenCalled();
  });

  it('should handle various text formats', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      text: '2 eggs, 1 slice toast with butter',
    });

    expect(result.success).toBe(true);
  });
});

// ==================== LogFoodFromVoice Tests ====================

describe('LogFoodFromVoice', () => {
  let useCase;
  let messagingGateway;
  let logFoodFromText;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    logFoodFromText = {
      execute: jest.fn().mockResolvedValue({ success: true, itemCount: 2 }),
    };

    useCase = new LogFoodFromVoice({
      messagingGateway,
      logFoodFromText,
    });
  });

  it('should transcribe and delegate to LogFoodFromText', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      voiceData: { fileId: 'voice-123' },
    });

    expect(result.success).toBe(true);
    expect(messagingGateway.transcribeVoice).toHaveBeenCalledWith('voice-123');
    expect(logFoodFromText.execute).toHaveBeenCalled();
  });

  it('should handle empty transcription', async () => {
    messagingGateway.transcribeVoice.mockResolvedValue('');

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      voiceData: { fileId: 'voice-123' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Empty transcription');
  });
});

// ==================== LogFoodFromUPC Tests ====================

describe('LogFoodFromUPC', () => {
  let useCase;
  let messagingGateway;
  let upcGateway;
  let nutrilogRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    upcGateway = createMockUPCGateway();
    nutrilogRepository = createMockNutrilogRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new LogFoodFromUPC({
      messagingGateway,
      upcGateway,
      nutrilogRepository,
      conversationStateStore,
    });
  });

  it('should look up product and create log', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      upc: '012345678901',
    });

    expect(result.success).toBe(true);
    expect(result.product).toBeDefined();
    expect(result.product.name).toBe('Protein Bar');
    expect(upcGateway.lookup).toHaveBeenCalledWith('012345678901');
  });

  it('should set portion selection state', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      upc: '012345678901',
    });

    const state = await conversationStateStore.get('chat-1');
    expect(state.flow).toBe('upc_portion');
  });

  it('should handle product not found', async () => {
    upcGateway.lookup.mockResolvedValue(null);

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      upc: '999999999999',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Product not found');
  });
});

// ==================== AcceptFoodLog Tests ====================

describe('AcceptFoodLog', () => {
  let useCase;
  let messagingGateway;
  let nutrilogRepository;
  let nutrilistRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    nutrilogRepository = createMockNutrilogRepository();
    nutrilistRepository = createMockNutrilistRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new AcceptFoodLog({
      messagingGateway,
      nutrilogRepository,
      nutrilistRepository,
      conversationStateStore,
    });

    // Set up a pending log
    nutrilogRepository._logs.set('log-1', {
      uuid: 'log-1',
      status: NutriLogStatus.INIT,
      items: [
        { name: 'Chicken', calories: 250, protein: 40, carbs: 0, fat: 8 },
      ],
    });
  });

  it('should confirm log and add to nutrilist', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    expect(result.success).toBe(true);
    expect(nutrilogRepository.updateStatus).toHaveBeenCalledWith('log-1', NutriLogStatus.CONFIRMED);
    expect(nutrilistRepository.saveMany).toHaveBeenCalled();
  });

  it('should clear conversation state', async () => {
    conversationStateStore._states.set('chat-1', { flow: 'food_confirmation' });

    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    expect(conversationStateStore.delete).toHaveBeenCalledWith('chat-1');
  });

  it('should return not found for missing log', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'nonexistent',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Log not found');
  });
});

// ==================== DiscardFoodLog Tests ====================

describe('DiscardFoodLog', () => {
  let useCase;
  let messagingGateway;
  let nutrilogRepository;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    nutrilogRepository = createMockNutrilogRepository();

    useCase = new DiscardFoodLog({
      messagingGateway,
      nutrilogRepository,
    });
  });

  it('should mark log as discarded', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    expect(result.success).toBe(true);
    expect(nutrilogRepository.updateStatus).toHaveBeenCalledWith('log-1', NutriLogStatus.DISCARDED);
  });

  it('should send confirmation message', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    expect(messagingGateway.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      '🗑️ Discarded.',
      {}
    );
  });
});

// ==================== ReviseFoodLog Tests ====================

describe('ReviseFoodLog', () => {
  let useCase;
  let messagingGateway;
  let nutrilogRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    nutrilogRepository = createMockNutrilogRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new ReviseFoodLog({
      messagingGateway,
      nutrilogRepository,
      conversationStateStore,
    });

    nutrilogRepository._logs.set('log-1', {
      uuid: 'log-1',
      items: [{ name: 'Chicken', quantity: 1 }],
    });
  });

  it('should enter revision mode', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('revision');
  });

  it('should set conversation state to revision', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      logUuid: 'log-1',
    });

    const state = await conversationStateStore.get('chat-1');
    expect(state.flow).toBe('revision');
    expect(state.pendingLogUuid).toBe('log-1');
  });
});

// ==================== ProcessRevisionInput Tests ====================

describe('ProcessRevisionInput', () => {
  let useCase;
  let messagingGateway;
  let aiGateway;
  let nutrilogRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    aiGateway = createMockAIGateway(JSON.stringify({
      items: [
        { name: 'Grilled Chicken', quantity: 200, unit: 'g', calories: 330, protein: 50, carbs: 0, fat: 10 },
      ]
    }));
    nutrilogRepository = createMockNutrilogRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new ProcessRevisionInput({
      messagingGateway,
      aiGateway,
      nutrilogRepository,
      conversationStateStore,
    });

    nutrilogRepository._logs.set('log-1', {
      uuid: 'log-1',
      items: [{ name: 'Chicken', quantity: 150, unit: 'g' }],
    });
    conversationStateStore._states.set('chat-1', {
      flow: 'revision',
      pendingLogUuid: 'log-1',
    });
  });

  it('should apply revision and update log', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      text: 'change chicken to 200g',
    });

    expect(result.success).toBe(true);
    expect(nutrilogRepository.updateItems).toHaveBeenCalled();
  });

  it('should return to confirmation flow', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      text: 'change chicken to 200g',
    });

    const state = await conversationStateStore.get('chat-1');
    expect(state.flow).toBe('food_confirmation');
  });

  it('should reject if not in revision mode', async () => {
    conversationStateStore._states.delete('chat-1');

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      text: 'change chicken to 200g',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not in revision mode');
  });
});

// ==================== SelectUPCPortion Tests ====================

describe('SelectUPCPortion', () => {
  let useCase;
  let messagingGateway;
  let nutrilogRepository;
  let nutrilistRepository;
  let conversationStateStore;

  beforeEach(() => {
    messagingGateway = createMockMessagingGateway();
    nutrilogRepository = createMockNutrilogRepository();
    nutrilistRepository = createMockNutrilistRepository();
    conversationStateStore = createMockConversationStateStore();

    useCase = new SelectUPCPortion({
      messagingGateway,
      nutrilogRepository,
      nutrilistRepository,
      conversationStateStore,
    });

    nutrilogRepository._logs.set('log-1', {
      uuid: 'log-1',
      items: [{ name: 'Protein Bar', calories: 200, protein: 20, carbs: 25, fat: 8 }],
    });
    conversationStateStore._states.set('chat-1', {
      flow: 'upc_portion',
      pendingLogUuid: 'log-1',
    });
  });

  it('should apply portion factor', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      portionFactor: 0.5,
    });

    expect(result.success).toBe(true);
    expect(result.scaledItems[0].calories).toBe(100); // 200 * 0.5
    expect(result.scaledItems[0].protein).toBe(10);   // 20 * 0.5
  });

  it('should confirm log after portion selection', async () => {
    await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      portionFactor: 1,
    });

    expect(nutrilogRepository.updateStatus).toHaveBeenCalledWith('log-1', NutriLogStatus.CONFIRMED);
  });

  it('should reject if not in portion mode', async () => {
    conversationStateStore._states.delete('chat-1');

    const result = await useCase.execute({
      userId: 'user-1',
      conversationId: 'chat-1',
      portionFactor: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not in portion selection mode');
  });
});
