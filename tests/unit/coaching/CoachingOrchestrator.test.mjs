import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoachingOrchestrator } from '../../../backend/src/3_applications/coaching/CoachingOrchestrator.mjs';

describe('CoachingOrchestrator', () => {
  let orchestrator;
  let mockCommentary;
  let mockMessaging;
  let mockHealthStore;
  let mockNutriListStore;
  let mockConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T20:00:00Z')); // 1pm PDT on the post-report date
    mockCommentary = { generate: vi.fn().mockResolvedValue('Nice protein hit.') };
    mockMessaging = { sendMessage: vi.fn().mockResolvedValue({ messageId: '123' }), deleteMessage: vi.fn().mockResolvedValue(undefined) };
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

  afterEach(() => vi.useRealTimers());

  describe('post-meal coaching', () => {
    it('skips a back-dated report', async () => {
      await orchestrator.sendPostReport({ userId: 'user_1', conversationId: 'telegram:123', date: '2026-04-05' });
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });

    it("sums today's items when no totals are given, and marks the day in progress", async () => {
      await orchestrator.sendPostReport({ userId: 'user_1', conversationId: 'telegram:123' });
      const [, text] = mockMessaging.sendMessage.mock.calls[0];
      expect(text).toContain('<b>500 / 1600 cal</b>');
      expect(text).toContain('<b>45 / 120g protein</b>');
      const snapshot = mockCommentary.generate.mock.calls[0][0];
      expect(snapshot.today_status).toBe('in_progress');
      expect(snapshot.recent_days.every(d => d.status)).toBe(true);
    });

    it("replaces the day's previous post-report message", async () => {
      mockHealthStore.loadCoachingData.mockResolvedValue({
        '2026-04-07': [{ type: 'post-report', text: 'old', messageId: '77', timestamp: '2026-04-07T18:00:00Z' }],
      });
      await orchestrator.sendPostReport({ userId: 'user_1', conversationId: 'telegram:123' });
      expect(mockMessaging.deleteMessage).toHaveBeenCalledWith('telegram:123', '77');
      const [, data] = mockHealthStore.saveCoachingData.mock.calls[0];
      expect(data['2026-04-07'].at(-1)).toMatchObject({ type: 'post-report', messageId: '123' });
    });

    it('stays silent when nothing is logged today', async () => {
      mockNutriListStore.findByDate.mockResolvedValue([]);
      await orchestrator.sendPostReport({ userId: 'user_1', conversationId: 'telegram:123' });
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('exercise reaction', () => {
    const activity = { id: 987, type: 'Ride', durationMin: 45, caloriesBurned: 420 };

    it('sends once per activity', async () => {
      await orchestrator.sendExerciseReaction({ userId: 'user_1', conversationId: 'telegram:123', activity });
      expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
      const [, data] = mockHealthStore.saveCoachingData.mock.calls[0];
      expect(data['2026-04-07'][0]).toMatchObject({ type: 'exercise-reaction', activityId: '987' });

      mockHealthStore.loadCoachingData.mockResolvedValue(data);
      await orchestrator.sendExerciseReaction({ userId: 'user_1', conversationId: 'telegram:123', activity });
      expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    });

    it("gives the model today's running total as in progress", async () => {
      await orchestrator.sendExerciseReaction({ userId: 'user_1', conversationId: 'telegram:123', activity });
      const snapshot = mockCommentary.generate.mock.calls[0][0];
      expect(snapshot.today_calories.consumed).toBe(500);
      expect(snapshot.today_status).toBe('in_progress');
      expect(mockMessaging.sendMessage.mock.calls[0][1]).toContain('~210 extra cal earned');
    });
  });

  it('sends post-report message with status block + commentary', async () => {
    await orchestrator.sendPostReport({
      userId: 'user_1',
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
      userId: 'user_1',
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
      userId: 'user_1',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockHealthStore.saveCoachingData).toHaveBeenCalledOnce();
    const [userId, data] = mockHealthStore.saveCoachingData.mock.calls[0];
    expect(userId).toBe('user_1');
    expect(data['2026-04-07']).toBeDefined();
    expect(data['2026-04-07'][0].type).toBe('post-report');
  });

  it('still sends status block when LLM throws', async () => {
    mockCommentary.generate.mockRejectedValue(new Error('timeout'));

    await orchestrator.sendPostReport({
      userId: 'user_1',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    const [, text] = mockMessaging.sendMessage.mock.calls[0];
    expect(text).toContain('<b>850 / 1600 cal</b>');
  });

  describe('morning brief completeness', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T17:00:00Z')); // 10am PDT
    });
    afterEach(() => vi.useRealTimers());

    it('flags a partially logged yesterday and keeps it out of the average and commentary facts', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({
        '2026-09-16': { calories: 460, protein: 18 },
        '2026-09-15': { calories: 1495.4, protein: 85.2 },
        '2026-09-14': { calories: 1605, protein: 91 },
      });
      await orchestrator.sendMorningBrief({ userId: 'kckern', conversationId: 'telegram:1' });

      const [, text] = mockMessaging.sendMessage.mock.calls[0];
      expect(text).toContain('460 cal · 18g protein logged — looks incomplete');
      expect(text).toContain('1550 cal · 88g protein');
      expect(text).toContain('2 of 7 days fully logged');

      const snapshot = mockCommentary.generate.mock.calls[0][0];
      expect(snapshot.yesterday.status).toBe('incomplete');
      expect(snapshot.recent_pattern).toBe('missed_logging');
      expect(snapshot.logging.min_calories).toBe(1200);
    });

    it('trusts a low yesterday the user marked done', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-09-16': { calories: 900, protein: 80 } });
      mockHealthStore.loadDayClosedData = vi.fn().mockResolvedValue({ '2026-09-16': { status: 'done' } });
      await orchestrator.sendMorningBrief({ userId: 'kckern', conversationId: 'telegram:1' });

      const [, text] = mockMessaging.sendMessage.mock.calls[0];
      expect(text).toContain('<b>Yesterday:</b> 900 cal · 80g protein');
      expect(text).not.toContain('incomplete');
    });

    it('honours a configured threshold', async () => {
      const strict = new CoachingOrchestrator({
        commentaryService: mockCommentary, messagingGateway: mockMessaging, healthStore: mockHealthStore,
        nutriListStore: mockNutriListStore, config: mockConfig, completeness: { min_calories: 1500 },
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-09-16': { calories: 1300, protein: 80 } });
      await strict.sendMorningBrief({ userId: 'kckern', conversationId: 'telegram:1' });
      expect(mockMessaging.sendMessage.mock.calls[0][1]).toContain('Under 1500 cal');
    });

    it('reads weight from the lbs fields weight.yml actually carries', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({ '2026-09-16': { calories: 1500, protein: 120 } });
      mockHealthStore.loadWeightData.mockResolvedValue({
        '2026-09-10': { lbs: 171, lbs_adjusted_average: 170.8 },
        '2026-09-17': { lbs: 170, lbs_adjusted_average: 170.2 },
      });
      await orchestrator.sendMorningBrief({ userId: 'kckern', conversationId: 'telegram:1' });
      expect(mockMessaging.sendMessage.mock.calls[0][1]).toContain('170.2 lbs (-0.60/wk)');
    });
  });

  describe('weekly digest completeness', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-21T02:00:00Z')); // Sun 7pm PDT, 09-20
    });
    afterEach(() => vi.useRealTimers());

    it('averages only trusted days and states the coverage', async () => {
      mockHealthStore.loadNutritionData.mockResolvedValue({
        '2026-09-19': { calories: 1800, protein: 120 },
        '2026-09-18': { calories: 831, protein: 83 },
        '2026-09-17': { calories: 630, protein: 64 },
        '2026-09-16': { calories: 1600, protein: 100 },
        '2026-09-15': { calories: 0, protein: 0 },
      });
      mockHealthStore.loadDayClosedData = vi.fn().mockResolvedValue({ '2026-09-15': { status: 'fasting' } });
      await orchestrator.sendWeeklyDigest({ userId: 'kckern', conversationId: 'telegram:1' });

      const [, text] = mockMessaging.sendMessage.mock.calls[0];
      expect(text).toContain('1133 avg cal · 73g avg protein · 3 of 7 days fully logged');
      const snapshot = mockCommentary.generate.mock.calls[0][0];
      expect(snapshot.week_days.map(d => d.status)).toEqual(
        ['complete', 'incomplete', 'incomplete', 'complete', 'fasting', 'unlogged', 'unlogged']);
    });
  });
});

