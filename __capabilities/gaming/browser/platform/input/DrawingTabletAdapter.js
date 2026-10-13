import { interactionIntent } from '@shared-interaction/index.mjs';

function point(event, element) {
  const rect = element.getBoundingClientRect();
  const scaleX = rect.width > 0 && Number.isFinite(element.width) ? element.width / rect.width : 1;
  const scaleY = rect.height > 0 && Number.isFinite(element.height) ? element.height / rect.height : 1;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return {
    x: Math.max(0, Math.min(element.width ?? x, x)),
    y: Math.max(0, Math.min(element.height ?? y, y)),
    pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : (event.buttons ? 0.5 : 0),
    eraser: event.button === 5 || event.pointerType === 'pen' && (event.buttons & 32) !== 0,
    pointer_id: event.pointerId ?? 1,
  };
}

export class DrawingTabletAdapter {
  constructor({ element, onIntent, now = () => performance.now(), pointerEvents = typeof globalThis.PointerEvent === 'function' }) { Object.assign(this, { element, onIntent, now, pointerEvents }); this.listeners = []; this.activePointers = new Set(); }
  emit(phase, event) {
    const pointerId = event.pointerId ?? 1;
    if (phase === 'press') {
      this.activePointers.add(pointerId);
      this.element.setPointerCapture?.(pointerId);
    } else if (phase === 'change' && !this.activePointers.has(pointerId)) return;
    event.preventDefault?.();
    this.onIntent(interactionIntent({ action: 'drawing.stroke', phase, value: point(event, this.element), source: event.pointerType === 'pen' ? 'stylus' : event.pointerType === 'touch' ? 'touch' : 'mouse', deviceType: event.pointerType || 'mouse', controllerId: `pointer:${pointerId}`, timestamp: event.timeStamp || this.now() }));
    if (phase === 'release') { this.activePointers.delete(pointerId); this.element.releasePointerCapture?.(pointerId); }
  }
  listen(target, name, listener, options) { target.addEventListener(name, listener, options); this.listeners.push([target, name, listener, options]); }
  connect() {
    if (this.pointerEvents) {
      for (const [name, phase] of [['pointerdown', 'press'], ['pointermove', 'change'], ['pointerup', 'release'], ['pointercancel', 'release']]) this.listen(this.element, name, (event) => this.emit(phase, event));
    } else {
      const mouse = (pointerType, pointerId = 1) => (event) => this.emit(pointerType, { ...event, clientX: event.clientX, clientY: event.clientY, buttons: event.buttons, button: event.button, pointerType: 'mouse', pointerId, pressure: event.buttons ? .5 : 0, timeStamp: event.timeStamp, preventDefault: () => event.preventDefault() });
      this.listen(this.element, 'mousedown', mouse('press'));
      this.listen(this.element, 'mousemove', mouse('change'));
      this.listen(this.element, 'mouseup', mouse('release'));
      const touches = (phase) => (event) => { for (const touch of event.changedTouches || []) this.emit(phase, { clientX: touch.clientX, clientY: touch.clientY, buttons: phase === 'release' ? 0 : 1, button: 0, pointerType: 'touch', pointerId: touch.identifier + 2, pressure: touch.force || (phase === 'release' ? 0 : .5), timeStamp: event.timeStamp, preventDefault: () => event.preventDefault() }); };
      this.listen(this.element, 'touchstart', touches('press'), { passive: false });
      this.listen(this.element, 'touchmove', touches('change'), { passive: false });
      this.listen(this.element, 'touchend', touches('release'), { passive: false });
      this.listen(this.element, 'touchcancel', touches('release'), { passive: false });
    }
    return () => this.disconnect();
  }
  disconnect() { for (const [target, name, listener, options] of this.listeners) target.removeEventListener(name, listener, options); this.listeners = []; this.activePointers.clear(); }
}
