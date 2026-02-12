// frontend/src/screen-framework/input/InputManager.js
import { KeyboardAdapter } from './adapters/KeyboardAdapter.js';
import { NumpadAdapter } from './adapters/NumpadAdapter.js';
import { RemoteAdapter } from './adapters/RemoteAdapter.js';

export function createInputManager(actionBus, inputConfig) {
  if (!inputConfig || !inputConfig.type || !actionBus) {
    return { adapter: null, ready: Promise.resolve(), destroy() {} };
  }

  const { type, keyboard_id } = inputConfig;
  let adapter;

  switch (type) {
    case 'numpad':
      adapter = new NumpadAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'remote':
      adapter = new RemoteAdapter(actionBus, { keyboardId: keyboard_id });
      break;
    case 'keyboard':
    default:
      adapter = new KeyboardAdapter(actionBus);
      break;
  }

  const attachResult = adapter.attach();
  const ready = attachResult instanceof Promise ? attachResult : Promise.resolve();

  return {
    adapter,
    ready,
    destroy() { adapter.destroy(); },
  };
}
