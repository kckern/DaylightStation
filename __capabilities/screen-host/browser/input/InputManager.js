// frontend/src/screen-framework/input/InputManager.js
import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';
import { acquireGamepadInputHost } from './adapters/GamepadAdapter.js';
import { TouchAdapter } from './adapters/TouchAdapter.js';

export function createInputManager(actionBus, inputConfig) {
  if (!actionBus || !inputConfig) {
    return { adapter: null, ready: Promise.resolve(), destroy() {} };
  }

  const type = inputConfig?.type;
  const keyboard_id = inputConfig?.keyboard_id;
  let adapter;
  let gamepadLease = null;

  switch (type) {
    case 'numpad':
      adapter = new NumpadAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'remote':
      adapter = new RemoteAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'gamepad':
      gamepadLease = acquireGamepadInputHost(actionBus, { gamepadIndex: inputConfig.gamepad_index ?? null });
      adapter = gamepadLease.adapter;
      break;
    case 'touch':
      adapter = new TouchAdapter();
      break;
    case 'keyboard':
    default:
      adapter = new KeyboardAdapter(actionBus);
      break;
  }

  const attachResult = type === 'gamepad' ? undefined : adapter.attach();
  const ready = attachResult instanceof Promise ? attachResult : Promise.resolve();

  // Always attach a GamepadAdapter alongside the primary adapter.
  // It only polls when a gamepad is connected, so there's no overhead.
  // This ensures face/shoulder buttons work even without explicit gamepad config.
  if (type !== 'gamepad') {
    gamepadLease = acquireGamepadInputHost(actionBus, { gamepadIndex: inputConfig?.gamepad_index ?? null });
  }

  return {
    adapter,
    ready,
    destroy() {
      if (type !== 'gamepad') adapter.destroy();
      gamepadLease?.release();
    },
  };
}
