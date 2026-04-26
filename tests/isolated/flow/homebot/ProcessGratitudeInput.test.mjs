// tests/unit/applications/homebot/ProcessGratitudeInput.test.mjs
import { vi } from 'vitest';

describe('ProcessGratitudeInput', () => {
  let useCase;
  let mockMessagingGateway;
  let mockAiGateway;
  let mockStateStore;
  let mockHouseholdService;

  beforeEach(async () => {
    mockMessagingGateway = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'msg123' }),
      updateMessage: vi.fn().mockResolvedValue(undefined)
    };
    mockAiGateway = {
      chatWithJson: vi.fn().mockResolvedValue({
        items: [{ text: 'Good health' }, { text: 'Family' }],
        category: 'gratitude'
      })
    };
    mockStateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null)
    };
    mockHouseholdService = {
      getMembers: vi.fn().mockResolvedValue([
        { username: 'user1', displayName: 'User One' }
      ])
    };

    const { ProcessGratitudeInput } = await import('#backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs');
    useCase = new ProcessGratitudeInput({
      messagingGateway: mockMessagingGateway,
      aiGateway: mockAiGateway,
      conversationStateStore: mockStateStore,
      householdService: mockHouseholdService,
      logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() }
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
