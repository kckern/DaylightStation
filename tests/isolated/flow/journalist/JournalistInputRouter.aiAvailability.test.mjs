import { describe, expect, it, vi } from 'vitest';
import { JournalistInputRouter } from '#apps/journalist/services/JournalistInputRouter.mjs';

function unavailableRouter() {
  const useCases = {
    text: { execute: vi.fn() },
    voice: { execute: vi.fn() },
    command: { execute: vi.fn() },
    interview: { execute: vi.fn() },
    specialStart: { execute: vi.fn() },
  };
  const container = {
    getProcessTextEntry: () => useCases.text,
    getProcessVoiceEntry: () => useCases.voice,
    getHandleSlashCommand: () => useCases.command,
    getInitiateDebriefInterview: () => useCases.interview,
    getHandleSpecialStart: () => useCases.specialStart,
  };
  return { router: new JournalistInputRouter(container, {
    aiGatewayAvailable: false,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  }), useCases };
}

function event(type, payload = {}) {
  return {
    type,
    platform: 'telegram',
    platformUserId: 'person-1',
    conversationId: 'telegram:b1_c1',
    messageId: 'm1',
    payload,
    metadata: { senderId: 'person-1' },
  };
}

describe('JournalistInputRouter AI availability', () => {
  it.each([
    ['text', event('text', { text: 'today was difficult' }), 'text'],
    ['voice', event('voice', { fileId: 'voice-1' }), 'voice'],
    ['AI command', event('command', { command: 'prompt', text: '' }), 'command'],
  ])('returns a visible refusal for %s without invoking the use case', async (_name, input, useCase) => {
    const { router, useCases } = unavailableRouter();
    const responseContext = { sendMessage: vi.fn().mockResolvedValue() };

    await expect(router.route(input, responseContext)).resolves.toMatchObject({
      ok: false,
      code: 'AI_UNAVAILABLE',
    });

    expect(useCases[useCase].execute).not.toHaveBeenCalled();
    expect(responseContext.sendMessage).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'), {});
  });

  it('keeps unknown commands available as help', async () => {
    const { router, useCases } = unavailableRouter();
    const responseContext = { sendMessage: vi.fn().mockResolvedValue() };

    await router.route(event('command', { command: 'help', text: '' }), responseContext);

    expect(useCases.command.execute).toHaveBeenCalled();
  });

  it('does not send 🎲 special-start through the AI prompt flow', async () => {
    const { router, useCases } = unavailableRouter();
    const responseContext = { sendMessage: vi.fn().mockResolvedValue() };
    await expect(router.route(event('text', { text: '🎲' }), responseContext)).resolves.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(useCases.specialStart.execute).not.toHaveBeenCalled();
  });
});
