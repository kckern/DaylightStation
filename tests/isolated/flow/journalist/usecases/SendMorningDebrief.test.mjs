// tests/isolated/flow/journalist/usecases/SendMorningDebrief.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('SendMorningDebrief — adaptive headline assembly', () => {
  let SendMorningDebrief;
  let useCase;
  let sent; // captures (text, options) of the outbound message
  let responseContext;
  let mockLogger;

  // Build the expected subordinate date label the same way the use case does,
  // so the assertion is timezone-agnostic for a fixed date.
  function dateLabel(date) {
    const d = new Date(date + 'T00:00:00');
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const day = d.toLocaleDateString('en-US', { day: 'numeric' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${weekday} · ${day} ${month} · yesterday`;
  }

  beforeEach(async () => {
    sent = null;
    responseContext = {
      sendMessage: vi.fn().mockImplementation((text, options) => {
        sent = { text, options };
        return Promise.resolve({ messageId: 'msg-1' });
      }),
    };
    mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const module = await import(
      '#backend/src/3_applications/journalist/usecases/SendMorningDebrief.mjs'
    );
    SendMorningDebrief = module.SendMorningDebrief;
    useCase = new SendMorningDebrief({ logger: mockLogger });
  });

  const baseDebrief = (overrides = {}) => ({
    success: true,
    date: '2026-05-31',
    summary: '🌅 Morning\n• 6:30a Bishopric meeting, 1h',
    ...overrides,
  });

  it('leads a question headline with 💬 and demotes the date to a subordinate line', async () => {
    await useCase.execute({
      conversationId: 'c1',
      responseContext,
      debrief: baseDebrief({ headline: 'Was the Korean ever going to stick?' }),
    });

    expect(sent.text.startsWith('💬 <b>Was the Korean ever going to stick?</b>\n')).toBe(true);
    expect(sent.text).toContain(`<i>${dateLabel('2026-05-31')}</i>`);
    // The styled summary still follows below the headline block.
    expect(sent.text).toContain('Bishopric meeting');
  });

  it('leads a deduction/statement headline (no trailing ?) with 💭', async () => {
    await useCase.execute({
      conversationId: 'c1',
      responseContext,
      debrief: baseDebrief({ headline: 'Church leadership ate your whole morning' }),
    });

    expect(sent.text.startsWith('💭 <b>Church leadership ate your whole morning</b>\n')).toBe(true);
  });

  it('falls back to the legacy date header when no headline is present', async () => {
    await useCase.execute({
      conversationId: 'c1',
      responseContext,
      debrief: baseDebrief({ headline: null }),
    });

    expect(sent.text.startsWith('📅 <b>Yesterday</b> (')).toBe(true);
  });

  it('HTML-escapes the headline text', async () => {
    await useCase.execute({
      conversationId: 'c1',
      responseContext,
      debrief: baseDebrief({ headline: 'Felix & the <locked> door?' }),
    });

    expect(sent.text).toContain('💬 <b>Felix &amp; the &lt;locked&gt; door?</b>');
  });
});
