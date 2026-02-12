const KEY_MAP = {
  ArrowUp:    { action: 'navigate', payload: { direction: 'up' } },
  ArrowDown:  { action: 'navigate', payload: { direction: 'down' } },
  ArrowLeft:  { action: 'navigate', payload: { direction: 'left' } },
  ArrowRight: { action: 'navigate', payload: { direction: 'right' } },
  Enter:      { action: 'select',   payload: {} },
  Escape:     { action: 'escape',   payload: {} },
};

export class KeyboardAdapter {
  constructor(actionBus) {
    this.actionBus = actionBus;
    this.handler = null;
  }

  attach() {
    this.handler = (event) => {
      const mapped = KEY_MAP[event.key];
      if (mapped) {
        this.actionBus.emit(mapped.action, mapped.payload);
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
  }
}
