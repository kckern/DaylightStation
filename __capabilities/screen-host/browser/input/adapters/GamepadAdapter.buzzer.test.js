import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { bindNextGamepadPress, cancelPendingGamepadBind, clearGamepadRoleBindings, restoreGamepadRoleBindings, GamepadAdapter } from './GamepadAdapter.js';

function pad(index = 0, id = 'Buzzer Pad') {
  return { index, id, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0] };
}
function press(gamepad, idx) { gamepad.buttons[idx] = { pressed: true, value: 1 }; }
function release(gamepad, idx) { gamepad.buttons[idx] = { pressed: false, value: 0 }; }

function harness() {
  const bus = new ActionBus();
  const emitted = vi.spyOn(bus, 'emit');
  const keys = []; const onKey = (e) => keys.push(e.key); window.addEventListener('keydown', onKey);
  const intents = []; const onIntent = (e) => intents.push(e.detail); window.addEventListener('gaming:interaction', onIntent);
  const adapter = new GamepadAdapter(bus);
  return { adapter, emitted, keys, intents, done() { window.removeEventListener('keydown', onKey); window.removeEventListener('gaming:interaction', onIntent); } };
}

describe('GamepadAdapter team buzzers', () => {
  afterEach(() => { clearGamepadRoleBindings(); vi.useRealTimers(); });

  it('a bound controller emits no navigation, only a buzz intent', () => {
    // The 50ms phantom-dedupe window reads performance.now(); fake it so the
    // second press lands outside the window.
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
    const h = harness(); const gp = pad();
    h.adapter._pollOne(gp);                      // seed
    bindNextGamepadPress('team_1');
    press(gp, 0); h.adapter._pollOne(gp);        // binding press
    release(gp, 0); h.adapter._pollOne(gp);
    vi.advanceTimersByTime(100);
    press(gp, 0); h.adapter._pollOne(gp);        // A on a bound controller
    expect(h.emitted).not.toHaveBeenCalled();
    expect(h.keys).toEqual([]);
    expect(h.intents.filter((i) => i.phase === 'press')).toHaveLength(2);
    expect(h.intents.at(-1)).toMatchObject({ role_binding: 'team_1', controller_id: '0:Buzzer Pad' });
    h.done();
  });

  it('any input buzzes: unmapped buttons, home, and stick deflection', () => {
    const h = harness(); const gp = pad();
    restoreGamepadRoleBindings({ 'gamepad:0:Buzzer Pad': 'team_2' });
    h.adapter._pollOne(gp);
    press(gp, 16); h.adapter._pollOne(gp);                 // home
    gp.axes[0] = -0.9; h.adapter._pollOne(gp);             // stick left
    press(gp, 10); h.adapter._pollOne(gp);                 // left stick click
    const presses = h.intents.filter((i) => i.phase === 'press');
    expect(presses.map((i) => i.action)).toEqual(['button.home', 'stick.left', 'button.ls']);
    expect(h.keys).toEqual([]);
    h.done();
  });

  it('an unbound controller still navigates', () => {
    const h = harness(); const gp = pad(1, 'Host Pad');
    h.adapter._pollOne(gp);
    press(gp, 0); h.adapter._pollOne(gp);
    expect(h.emitted).toHaveBeenCalledWith('select', {});
    h.done();
  });

  it('clearing bindings returns a controller to navigation', () => {
    const h = harness(); const gp = pad();
    restoreGamepadRoleBindings({ 'gamepad:0:Buzzer Pad': 'team_1', slot_1: 'team_2' });
    clearGamepadRoleBindings();
    h.adapter._pollOne(gp);
    press(gp, 0); h.adapter._pollOne(gp);
    expect(h.emitted).toHaveBeenCalledWith('select', {});
    h.done();
  });

  it('a cancelled bind does not swallow the next press', () => {
    const h = harness(); const gp = pad();
    bindNextGamepadPress('team_3'); cancelPendingGamepadBind();
    h.adapter._pollOne(gp);
    press(gp, 0); h.adapter._pollOne(gp);
    expect(h.emitted).toHaveBeenCalledWith('select', {});
    h.done();
  });

  it('a phantom twin of a bound controller cannot navigate (bound one is polled first)', async () => {
    const h = harness();
    const phantom = pad(0, 'Twin Pad'); const real = pad(1, 'Twin Pad');
    restoreGamepadRoleBindings({ 'gamepad:1:Twin Pad': 'team_1' });
    const filtering = await import('../gamepadFiltering.js');
    const spy = vi.spyOn(filtering, 'getActiveGamepads').mockReturnValue([phantom, real]);
    h.adapter._pollGamepad();                                // seed both
    press(phantom, 0); press(real, 0);                       // mirrored state
    h.adapter._pollGamepad();
    expect(h.emitted).not.toHaveBeenCalled();
    expect(h.keys).toEqual([]);
    expect(h.intents.filter((i) => i.phase === 'press').map((i) => i.controller_id)).toEqual(['1:Twin Pad']);
    spy.mockRestore(); h.done();
  });
});

it('setup capture swallows Start/Back from every pad without assigning a duplicate team', async () => {
  const { acquireGamepadBuzzerCapture } = await import('./GamepadAdapter.js');
  const h = harness(); const gp = pad();
  const stop = acquireGamepadBuzzerCapture();
  h.adapter._pollOne(gp);
  press(gp, 9); h.adapter._pollOne(gp);
  press(gp, 8); h.adapter._pollOne(gp);
  expect(h.keys).toEqual([]);
  expect(h.emitted).not.toHaveBeenCalled();
  expect(h.intents.filter(i => i.phase === 'press')).toHaveLength(2);
  stop(); h.done();
});

it('emits stick release so setup requires and accepts a fresh second deflection', () => {
  const h = harness(); const gp = pad();
  restoreGamepadRoleBindings({ 'gamepad:0:Buzzer Pad': 'red' });
  h.adapter._pollOne(gp); gp.axes[0] = 0.9; h.adapter._pollOne(gp);
  gp.axes[0] = 0; h.adapter._pollOne(gp);
  expect(h.intents.map(i => [i.action, i.phase])).toEqual([['stick.right', 'press'], ['stick.right', 'release']]);
  h.done(); clearGamepadRoleBindings();
});
