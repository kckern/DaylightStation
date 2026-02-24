// frontend/src/screen-framework/input/InputManager.js
import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';
import { GamepadAdapter } from './adapters/GamepadAdapter.js';

export function createInputManager(actionBus, inputConfig) {
  if (!actionBus) {
    return { adapter: null, ready: Promise.resolve(), destroy() {} };
  }

  const type = inputConfig?.type;
  const keyboard_id = inputConfig?.keyboard_id;
  let adapter;

  switch (type) {
    case 'numpad':
      adapter = new NumpadAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'remote':
      adapter = new RemoteAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'gamepad':
      adapter = new GamepadAdapter(actionBus, { gamepadIndex: inputConfig.gamepad_index ?? null });
      break;
    case 'keyboard':
    default:
      adapter = new KeyboardAdapter(actionBus);
      break;
  }

  const attachResult = adapter.attach();
  const ready = attachResult instanceof Promise ? attachResult : Promise.resolve();

  // Always attach a GamepadAdapter alongside the primary adapter.
  // It only polls when a gamepad is connected, so there's no overhead.
  // This ensures face/shoulder buttons work even without explicit gamepad config.
  let gamepadAdapter = null;
  if (type !== 'gamepad') {
    gamepadAdapter = new GamepadAdapter(actionBus, { gamepadIndex: inputConfig?.gamepad_index ?? null });
    gamepadAdapter.attach();
  }

  return {
    adapter,
    ready,
    destroy() {
      adapter.destroy();
      gamepadAdapter?.destroy();
    },
  };
}
