// tests/unit/applications/homebot/ProcessGratitudeInput.test.mjs
import { jest } from '@jest/globals';

describe('ProcessGratitudeInput', () => {
  let useCase;
  let mockMessagingGateway;
  let mockAiGateway;
  let mockStateStore;
  let mockHouseholdService;

  beforeEach(async () => {
    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg123' }),
      updateMessage: jest.fn().mockResolvedValue(undefined)
    };
    mockAiGateway = {
      chatWithJson: jest.fn().mockResolvedValue({
        items: [{ text: 'Good health' }, { text: 'Family' }],
        category: 'gratitude'
      })
    };
    mockStateStore = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null)
    };
    mockHouseholdService = {
      getMembers: jest.fn().mockResolvedValue([
        { username: 'user1', displayName: 'User One' }
      ])
    };

    const { ProcessGratitudeInput } = await import('@backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs');
    useCase = new ProcessGratitudeInput({
      messagingGateway: mockMessagingGateway,
      aiGateway: mockAiGateway,
      conversationStateStore: mockStateStore,
      householdService: mockHouseholdService,
      logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
    });
  });

  it('should extract items and show confirmation UI', async () => {
    await useCase.execute({
      conversationId: 'telegram:123',
      text: 'I am grateful for good health and family'
    });

    expect(mockAiGateway.chatWithJson).toHaveBeenCalled();
    expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    expect(mockStateStore.set).toHaveBeenCalled();
  });
});
