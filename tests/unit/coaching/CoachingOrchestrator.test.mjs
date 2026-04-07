import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoachingOrchestrator } from '../../../backend/src/3_applications/coaching/CoachingOrchestrator.mjs';

describe('CoachingOrchestrator', () => {
  let orchestrator;
  let mockCommentary;
  let mockMessaging;
  let mockHealthStore;
  let mockNutriListStore;
  let mockConfig;

  beforeEach(() => {
    mockCommentary = { generate: vi.fn().mockResolvedValue('Nice protein hit.') };
    mockMessaging = { sendMessage: vi.fn().mockResolvedValue({ messageId: '123' }) };
    mockHealthStore = {
      loadNutritionData: vi.fn().mockResolvedValue({}),
      loadWeightData: vi.fn().mockResolvedValue({}),
      loadCoachingData: vi.fn().mockResolvedValue({}),
      saveCoachingData: vi.fn(),
    };
    mockNutriListStore = {
      findByDate: vi.fn().mockResolvedValue([
        { name: 'Chicken', calories: 300, protein: 40 },
        { name: 'Rice', calories: 200, protein: 5 },
      ]),
    };
    mockConfig = {
      getUserGoals: vi.fn().mockReturnValue({ calories_min: 1200, calories_max: 1600, protein: 120 }),
      getUserTimezone: vi.fn().mockReturnValue('America/Los_Angeles'),
    };

    orchestrator = new CoachingOrchestrator({
      commentaryService: mockCommentary,
      messagingGateway: mockMessaging,
      healthStore: mockHealthStore,
      nutriListStore: mockNutriListStore,
      config: mockConfig,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('sends post-report message with status block + commentary', async () => {
    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    const [convId, text, opts] = mockMessaging.sendMessage.mock.calls[0];
    expect(convId).toBe('telegram:123');
    expect(text).toContain('<b>850 / 1600 cal</b>');
    expect(text).toContain('<blockquote>Nice protein hit.</blockquote>');
    expect(opts.parseMode).toBe('HTML');
  });

  it('sends status block without commentary when LLM returns empty', async () => {
    mockCommentary.generate.mockResolvedValue('');

    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    const [, text] = mockMessaging.sendMessage.mock.calls[0];
    expect(text).toContain('<b>850 / 1600 cal</b>');
    expect(text).not.toContain('<blockquote>');
  });

  it('persists coaching message to history', async () => {
    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockHealthStore.saveCoachingData).toHaveBeenCalledOnce();
    const [userId, data] = mockHealthStore.saveCoachingData.mock.calls[0];
    expect(userId).toBe('kckern');
    expect(data['2026-04-07']).toBeDefined();
    expect(data['2026-04-07'][0].type).toBe('post-report');
  });

  it('still sends status block when LLM throws', async () => {
    mockCommentary.generate.mockRejectedValue(new Error('timeout'));

    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    const [, text] = mockMessaging.sendMessage.mock.calls[0];
    expect(text).toContain('<b>850 / 1600 cal</b>');
  });
});
