import { describe, it, expect, vi } from 'vitest';
import { TelegramResponseContext } from './TelegramResponseContext.mjs';

describe('receipt handoff drains processing animation', () => {
  it.each(['text', 'photo'])('waits for in-flight %s edits and never restarts animation', async kind => {
    vi.useFakeTimers();
    try {
      let release;
      const adapter = {
        sendMessage: vi.fn(async () => ({ messageId: '22' })),
        sendImage: vi.fn(async () => ({ messageId: '22' })),
        updateMessage: vi.fn(() => new Promise(resolve => { release = resolve; })),
      };
      const context = new TelegramResponseContext(adapter, { chatId: 'chat' });
      const options = { frames: ['.', '..'], interval: 100 };
      const status = kind === 'text' ? await context.createStatusIndicator('Analyzing', options)
        : await context.createPhotoStatusIndicator('photo', 'Analyzing', options);
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.updateMessage).toHaveBeenCalledTimes(1);
      let drained = false;
      const handoff = status.release().then(() => { drained = true; });
      await vi.advanceTimersByTimeAsync(500);
      expect(drained).toBe(false);
      release(); await handoff;
      expect(status.kind).toBe(kind);
      await vi.advanceTimersByTimeAsync(1000);
      expect(adapter.updateMessage).toHaveBeenCalledTimes(1);
      expect(adapter.updateMessage.mock.calls[0][2]).toHaveProperty(kind === 'photo' ? 'caption' : 'text');
    } finally { vi.useRealTimers(); }
  });
});
