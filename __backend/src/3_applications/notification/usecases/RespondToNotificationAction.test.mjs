import { describe, it, expect, vi } from 'vitest';
import { RespondToNotificationAction } from './RespondToNotificationAction.mjs';

const input = { notificationId: 'n1', actionId: 'DONOW_APPROVE_7', reply: null, username: 'u' };
const handler = (prefix, result = { ok: true }) => ({ matches: id => id.startsWith(prefix), handle: vi.fn().mockResolvedValue(result) });

describe('RespondToNotificationAction', () => {
  it('runs the first handler that claims the action id', async () => {
    const a = handler('DONOW_'), b = handler('DONOW_APPROVE_');
    const uc = new RespondToNotificationAction({ handlers: [a, b] });
    expect(await uc.execute(input)).toEqual({ ok: true });
    expect(a.handle).toHaveBeenCalledWith(input);
    expect(b.handle).not.toHaveBeenCalled();
  });
  it('answers ACTION_UNKNOWN when no handler claims it', async () => {
    const logger = { warn: vi.fn() };
    const uc = new RespondToNotificationAction({ handlers: [handler('SUP_')], logger });
    expect(await uc.execute(input)).toEqual({ ok: false, code: 'ACTION_UNKNOWN' });
    expect(logger.warn).toHaveBeenCalledWith('notification.action.unknown', expect.objectContaining({ actionId: 'DONOW_APPROVE_7' }));
  });
  it('accepts handlers registered later', async () => {
    const uc = new RespondToNotificationAction();
    const a = handler('DONOW_');
    uc.register(a);
    expect((await uc.execute(input)).ok).toBe(true);
  });
  it('passes a handler refusal through', async () => {
    const uc = new RespondToNotificationAction({ handlers: [handler('DONOW_', { ok: false, code: 'ALREADY_DECIDED' })] });
    expect(await uc.execute(input)).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
  });
});

describe('RespondToNotificationAction.register', () => {
  it('refuses something that is not an action handler', () => {
    expect(() => new RespondToNotificationAction().register({ handle() {} })).toThrow(/action handler/);
  });
});
