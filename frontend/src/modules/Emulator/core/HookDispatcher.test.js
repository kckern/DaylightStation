import { describe, it, expect, vi } from 'vitest';
import { createHookDispatcher } from './HookDispatcher.js';

function makeHandlers() {
  return {
    governance: vi.fn(),
    cue: vi.fn(),
    chrome: vi.fn(),
    shader: vi.fn(),
    toast: vi.fn(),
    log: vi.fn(),
  };
}

describe('createHookDispatcher', () => {
  it('dispatches a matching hook to the correct handler', () => {
    const handlers = makeHandlers();
    const d = createHookDispatcher({ handlers });
    d.dispatch(
      [{ on: 'in_battle', do: { governance: { required_zone: 'hot' } } }],
      'in_battle'
    );
    expect(handlers.governance).toHaveBeenCalledTimes(1);
    expect(handlers.governance).toHaveBeenCalledWith({ required_zone: 'hot' });
  });

  it('does not dispatch a hook whose on does not match the eventId', () => {
    const handlers = makeHandlers();
    const d = createHookDispatcher({ handlers });
    d.dispatch(
      [{ on: 'out_of_battle', do: { governance: { required_zone: 'hot' } } }],
      'in_battle'
    );
    expect(handlers.governance).not.toHaveBeenCalled();
  });

  it('routes unknown actions to the log handler', () => {
    const handlers = makeHandlers();
    const d = createHookDispatcher({ handlers });
    d.dispatch(
      [{ on: 'in_battle', do: { mystery: { foo: 1 } } }],
      'in_battle'
    );
    expect(handlers.log).toHaveBeenCalledWith({
      unknownAction: 'mystery',
      payload: { foo: 1 },
    });
  });

  it('is a no-op for null or empty hooks', () => {
    const handlers = makeHandlers();
    const d = createHookDispatcher({ handlers });
    expect(() => d.dispatch(null, 'in_battle')).not.toThrow();
    expect(() => d.dispatch([], 'in_battle')).not.toThrow();
    expect(handlers.governance).not.toHaveBeenCalled();
  });

  it('dispatches multiple actions in one hook', () => {
    const handlers = makeHandlers();
    const d = createHookDispatcher({ handlers });
    d.dispatch(
      [{ on: 'win', do: { toast: { msg: 'gg' }, cue: { sound: 'fanfare' } } }],
      'win'
    );
    expect(handlers.toast).toHaveBeenCalledWith({ msg: 'gg' });
    expect(handlers.cue).toHaveBeenCalledWith({ sound: 'fanfare' });
  });
});
