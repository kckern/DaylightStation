/**
 * UnifiedEventRouter Tests
 * @module tests/application/UnifiedEventRouter.test
 */

import { UnifiedEventRouter } from '../../application/routing/UnifiedEventRouter.mjs';
import { createInputEvent, InputEventType } from '../../application/ports/IInputEvent.mjs';

/**
 * Create a mock container that records calls
 */
function createMockContainer() {
  const calls = {
    logFoodFromText: [],
    logFoodFromImage: [],
    logFoodFromVoice: [],
    logFoodFromUPC: [],
    acceptFoodLog: [],
    discardFoodLog: [],
    reviseFoodLog: [],
    processRevisionInput: [],
    selectUPCPortion: [],
    handleHelpCommand: [],
    generateDailyReport: [],
    startAdjustmentFlow: [],
    selectDateForAdjustment: [],
    selectItemForAdjustment: [],
    applyPortionAdjustment: [],
    deleteListItem: [],
    generateOnDemandCoaching: [],
    confirmAllPending: [],
    moveItemToDate: [],
  };

  const createMockUseCase = (name) => ({
    execute: async (params) => {
      calls[name].push(params);
      return { success: true };
    },
  });

  let stateStoreData = null;

  return {
    getLogFoodFromText: () => createMockUseCase('logFoodFromText'),
    getLogFoodFromImage: () => createMockUseCase('logFoodFromImage'),
    getLogFoodFromVoice: () => createMockUseCase('logFoodFromVoice'),
    getLogFoodFromUPC: () => createMockUseCase('logFoodFromUPC'),
    getAcceptFoodLog: () => createMockUseCase('acceptFoodLog'),
    getDiscardFoodLog: () => createMockUseCase('discardFoodLog'),
    getReviseFoodLog: () => createMockUseCase('reviseFoodLog'),
    getProcessRevisionInput: () => createMockUseCase('processRevisionInput'),
    getSelectUPCPortion: () => createMockUseCase('selectUPCPortion'),
    getHandleHelpCommand: () => createMockUseCase('handleHelpCommand'),
    getGenerateDailyReport: () => createMockUseCase('generateDailyReport'),
    getStartAdjustmentFlow: () => createMockUseCase('startAdjustmentFlow'),
    getSelectDateForAdjustment: () => createMockUseCase('selectDateForAdjustment'),
    getSelectItemForAdjustment: () => createMockUseCase('selectItemForAdjustment'),
    getApplyPortionAdjustment: () => createMockUseCase('applyPortionAdjustment'),
    getDeleteListItem: () => createMockUseCase('deleteListItem'),
    getGenerateOnDemandCoaching: () => createMockUseCase('generateOnDemandCoaching'),
    getConfirmAllPending: () => createMockUseCase('confirmAllPending'),
    getMoveItemToDate: () => createMockUseCase('moveItemToDate'),
    getConversationStateStore: () => ({
      get: async () => stateStoreData,
      set: async (id, data) => { stateStoreData = data; },
      update: async (id, updates) => { stateStoreData = { ...stateStoreData, ...updates }; },
      clear: async () => { stateStoreData = null; },
    }),
    _calls: calls,
    _setStateData: (data) => { stateStoreData = data; },
    _clearCalls: () => {
      Object.keys(calls).forEach(k => calls[k] = []);
    },
  };
}

describe('UnifiedEventRouter', () => {
  let router;
  let mockContainer;

  beforeEach(() => {
    mockContainer = createMockContainer();
    router = new UnifiedEventRouter(mockContainer);
  });

  describe('constructor', () => {
    it('should throw if container is not provided', () => {
      expect(() => new UnifiedEventRouter(null)).toThrow('container is required');
    });

    it('should create router with container', () => {
      const r = new UnifiedEventRouter(mockContainer);
      expect(r).toBeDefined();
      expect(r.getContainer()).toBe(mockContainer);
    });
  });

  describe('route() - text events', () => {
    it('should route text event to LogFoodFromText', async () => {
      const event = createInputEvent({
        type: InputEventType.TEXT,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { text: 'chicken salad' },
      });

      await router.route(event);

      expect(mockContainer._calls.logFoodFromText).toHaveLength(1);
      expect(mockContainer._calls.logFoodFromText[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        text: 'chicken salad',
        messageId: 'msg-1',
      });
    });

    it('should route text to ProcessRevisionInput when in revision flow', async () => {
      // Use correct state structure: activeFlow and flowState.pendingLogUuid
      mockContainer._setStateData({
        activeFlow: 'revision',
        flowState: {
          pendingLogUuid: 'log-uuid-123',
        },
      });

      const event = createInputEvent({
        type: InputEventType.TEXT,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { text: 'make it a turkey sandwich instead' },
      });

      await router.route(event);

      expect(mockContainer._calls.processRevisionInput).toHaveLength(1);
      expect(mockContainer._calls.processRevisionInput[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        text: 'make it a turkey sandwich instead',
        messageId: 'msg-1',
      });
    });
  });

  describe('route() - image events', () => {
    it('should route image event to LogFoodFromImage', async () => {
      const event = createInputEvent({
        type: InputEventType.IMAGE,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { fileId: 'file-123', url: null },
      });

      await router.route(event);

      expect(mockContainer._calls.logFoodFromImage).toHaveLength(1);
      expect(mockContainer._calls.logFoodFromImage[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        imageData: { fileId: 'file-123', url: null },
        messageId: 'msg-1',
      });
    });
  });

  describe('route() - voice events', () => {
    it('should route voice event to LogFoodFromVoice', async () => {
      const event = createInputEvent({
        type: InputEventType.VOICE,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { fileId: 'voice-123', duration: 5 },
      });

      await router.route(event);

      expect(mockContainer._calls.logFoodFromVoice).toHaveLength(1);
      expect(mockContainer._calls.logFoodFromVoice[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        voiceData: { fileId: 'voice-123', duration: 5 },
        messageId: 'msg-1',
      });
    });
  });

  describe('route() - UPC events', () => {
    it('should route UPC event to LogFoodFromUPC', async () => {
      const event = createInputEvent({
        type: InputEventType.UPC,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { upc: '012345678905' },
      });

      await router.route(event);

      expect(mockContainer._calls.logFoodFromUPC).toHaveLength(1);
      expect(mockContainer._calls.logFoodFromUPC[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        upc: '012345678905',
        messageId: 'msg-1',
      });
    });
  });

  describe('route() - command events', () => {
    it('should route /help command to HandleHelpCommand', async () => {
      const event = createInputEvent({
        type: InputEventType.COMMAND,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { command: 'help' },
      });

      await router.route(event);

      expect(mockContainer._calls.handleHelpCommand).toHaveLength(1);
    });

    it('should route /report command to GenerateDailyReport', async () => {
      const event = createInputEvent({
        type: InputEventType.COMMAND,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { command: 'report' },
      });

      await router.route(event);

      expect(mockContainer._calls.generateDailyReport).toHaveLength(1);
    });

    it('should route /adjust command to StartAdjustmentFlow', async () => {
      const event = createInputEvent({
        type: InputEventType.COMMAND,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { command: 'adjust' },
      });

      await router.route(event);

      expect(mockContainer._calls.startAdjustmentFlow).toHaveLength(1);
    });

    it('should route unknown command as text', async () => {
      const event = createInputEvent({
        type: InputEventType.COMMAND,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        messageId: 'msg-1',
        payload: { command: 'unknown' },
      });

      await router.route(event);

      expect(mockContainer._calls.logFoodFromText).toHaveLength(1);
      expect(mockContainer._calls.logFoodFromText[0].text).toBe('/unknown');
    });
  });

  describe('route() - callback events', () => {
    it('should route accept callback to AcceptFoodLog', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'accept:log-uuid-123',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.acceptFoodLog).toHaveLength(1);
      expect(mockContainer._calls.acceptFoodLog[0]).toEqual({
        userId: 'telegram:bot_123',
        conversationId: 'telegram:bot_123',
        logUuid: 'log-uuid-123',
        messageId: 'msg-1',
      });
    });

    it('should route discard callback to DiscardFoodLog', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'discard:log-uuid-123',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.discardFoodLog).toHaveLength(1);
    });

    it('should route revise callback to ReviseFoodLog', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'revise:log-uuid-123',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.reviseFoodLog).toHaveLength(1);
    });

    it('should route portion callback to SelectUPCPortion', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'portion:0.5',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.selectUPCPortion).toHaveLength(1);
    });
  });

  describe('route() - adjustment callbacks', () => {
    it('should route adj_start to StartAdjustmentFlow', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'adj_start',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.startAdjustmentFlow).toHaveLength(1);
    });

    it('should route adj_date_X to SelectDateForAdjustment', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'adj_date_2',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.selectDateForAdjustment).toHaveLength(1);
      expect(mockContainer._calls.selectDateForAdjustment[0].daysAgo).toBe(2);
    });

    it('should route adj_done to GenerateDailyReport', async () => {
      const event = createInputEvent({
        type: InputEventType.CALLBACK,
        channel: 'telegram',
        userId: '123',
        conversationId: 'telegram:bot_123',
        payload: { 
          data: 'adj_done',
          sourceMessageId: 'msg-1',
        },
      });

      await router.route(event);

      expect(mockContainer._calls.generateDailyReport).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should handle unknown event types gracefully', async () => {
      const event = {
        type: 'UNKNOWN_TYPE',
        userId: '123',
        conversationId: 'test',
        channel: 'test',
        timestamp: Date.now(),
        payload: {},
      };

      const result = await router.route(event);
      expect(result).toBeNull();
    });
  });
});
