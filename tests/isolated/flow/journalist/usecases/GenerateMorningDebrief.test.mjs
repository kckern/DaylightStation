// tests/isolated/flow/journalist/usecases/GenerateMorningDebrief.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GenerateMorningDebrief — HOOK parsing', () => {
  let GenerateMorningDebrief;
  let mockAiGateway;
  let mockLifelogAggregator;
  let mockLogger;

  beforeEach(async () => {
    mockLifelogAggregator = {
      aggregate: vi.fn().mockResolvedValue({
        _meta: { date: '2026-05-31', hasEnoughData: true, sources: ['calendar'] },
        summaryText: 'CALENDAR EVENTS (1):\n  - 6:30 AM Bishopric Meeting',
        summaries: [],
      }),
    };
    mockAiGateway = { chat: vi.fn() };
    mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const module = await import(
      '#backend/src/3_applications/journalist/usecases/GenerateMorningDebrief.mjs'
    );
    GenerateMorningDebrief = module.GenerateMorningDebrief;
  });

  const build = () =>
    new GenerateMorningDebrief({
      lifelogAggregator: mockLifelogAggregator,
      aiGateway: mockAiGateway,
      logger: mockLogger,
    });

  it('extracts the HOOK line into headline and strips it from the summary', async () => {
    mockAiGateway.chat.mockResolvedValue(
      'HOOK: Was the Korean ever going to stick?\n\n🌅 Morning\n• 6:30a Bishopric meeting, 1h',
    );

    const result = await build().execute({ username: 'kckern', date: '2026-05-31' });

    expect(result.success).toBe(true);
    expect(result.headline).toBe('Was the Korean ever going to stick?');
    expect(result.summary).not.toContain('HOOK:');
    expect(result.summary.startsWith('🌅 Morning')).toBe(true);
  });

  it('returns a null headline and unchanged summary when no HOOK prefix is present', async () => {
    const raw = '🌅 Morning\n• 6:30a Bishopric meeting, 1h\n\nCommentary\nA full day.';
    mockAiGateway.chat.mockResolvedValue(raw);

    const result = await build().execute({ username: 'kckern', date: '2026-05-31' });

    expect(result.headline).toBeNull();
    expect(result.summary).toBe(raw);
  });

  describe('hedge guard', () => {
    it('detects banned hedge words (containsHedge)', () => {
      expect(GenerateMorningDebrief.containsHedge('Looks like a big day')).toBe(true);
      expect(GenerateMorningDebrief.containsHedge('The thread, it seems, is alive')).toBe(true);
      expect(GenerateMorningDebrief.containsHedge('You must have been exhausted')).toBe(true);
      expect(GenerateMorningDebrief.containsHedge('Church swallowed your morning')).toBe(false);
    });

    it('rewrites a hedged headline via a focused second call and ships the de-hedged line', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('HOOK: Looks like the archive thread is in full swing\n\n🌅 Morning\n• x')
        .mockResolvedValueOnce('The archive thread is in full swing');

      const result = await build().execute({ username: 'kckern', date: '2026-05-31' });

      expect(mockAiGateway.chat).toHaveBeenCalledTimes(2);
      expect(result.headline).toBe('The archive thread is in full swing');
      expect(result.summary.startsWith('🌅 Morning')).toBe(true);
    });

    it('nulls the headline when the rewrite still hedges (legacy header fallback)', async () => {
      mockAiGateway.chat
        .mockResolvedValueOnce('HOOK: Looks like a busy day\n\n🌅 Morning\n• x')
        .mockResolvedValueOnce('Seems like a busy day');

      const result = await build().execute({ username: 'kckern', date: '2026-05-31' });

      expect(result.headline).toBeNull();
      expect(result.summary.startsWith('🌅 Morning')).toBe(true);
    });
  });
});
