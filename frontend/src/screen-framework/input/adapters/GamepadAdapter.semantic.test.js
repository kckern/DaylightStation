import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { bindNextGamepadPress, GamepadAdapter } from './GamepadAdapter.js';

describe('screen-framework gamepad semantic host', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('preserves ABXY identity and binds controller role on the next press', () => {
    const adapter = new GamepadAdapter(new ActionBus()); const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const gamepad = { index: 2, id: 'Family Pad', mapping: 'standard', buttons, axes: [0, 0] };
    const received = []; window.addEventListener('gaming:interaction', (event) => received.push(event.detail), { once: true });
    adapter._pollOne(gamepad); bindNextGamepadPress('team:red'); buttons[2] = { pressed: true, value: 1 }; adapter._pollOne(gamepad);
    expect(received[0]).toMatchObject({ action: 'button.x', phase: 'press', controller_id: '2:Family Pad', role_binding: 'team:red' });
  });
});
