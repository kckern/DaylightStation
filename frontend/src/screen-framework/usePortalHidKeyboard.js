import { useEffect } from 'react';
import getLogger from '../lib/logging/Logger.js';

const DEFAULT_PORT = 8774;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'portal-hid' });
  return _logger;
}

function validMessage(value) {
  return value && value.type === 'keyboard'
    && (value.action === 'down' || value.action === 'up')
    && typeof value.key === 'string' && value.key.length <= 64
    && typeof value.code === 'string' && value.code.length <= 64;
}

function eventTarget() {
  const active = document.activeElement;
  if (active && active !== document.documentElement) return active;
  return document.body || window;
}

function setElementValue(element, value, selection) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  if (selection != null && typeof element.setSelectionRange === 'function') {
    element.setSelectionRange(selection, selection);
  }
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function editTextControl(element, message) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element instanceof HTMLInputElement && !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(element.type)) return false;
  const start = Number.isInteger(element.selectionStart) ? element.selectionStart : element.value.length;
  const end = Number.isInteger(element.selectionEnd) ? element.selectionEnd : start;
  let value = element.value;
  let cursor = start;
  if (message.key.length === 1 && !message.ctrlKey && !message.altKey && !message.metaKey) {
    value = value.slice(0, start) + message.key + value.slice(end);
    cursor = start + message.key.length;
  } else if (message.key === 'Backspace') {
    const from = start === end ? Math.max(0, start - 1) : start;
    value = value.slice(0, from) + value.slice(end);
    cursor = from;
  } else if (message.key === 'Delete') {
    const to = start === end ? Math.min(value.length, end + 1) : end;
    value = value.slice(0, start) + value.slice(to);
    cursor = start;
  } else if (message.key === 'Enter' && element instanceof HTMLTextAreaElement) {
    value = value.slice(0, start) + '\n' + value.slice(end);
    cursor = start + 1;
  } else {
    return false;
  }
  setElementValue(element, value, cursor);
  return true;
}

function editContentEditable(element, message) {
  if (!(element instanceof HTMLElement) || !element.isContentEditable) return false;
  if (message.key.length === 1 && !message.ctrlKey && !message.altKey && !message.metaKey) {
    return document.execCommand?.('insertText', false, message.key) === true;
  }
  if (message.key === 'Backspace') return document.execCommand?.('delete', false) === true;
  if (message.key === 'Enter') return document.execCommand?.('insertLineBreak', false) === true;
  return false;
}

function moveFocus(backward) {
  const candidates = [...document.querySelectorAll(
    'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
  )].filter((node) => !node.disabled && node.getAttribute('aria-hidden') !== 'true');
  if (!candidates.length) return;
  const current = candidates.indexOf(document.activeElement);
  const delta = backward ? -1 : 1;
  const next = current < 0
    ? (backward ? candidates.length - 1 : 0)
    : (current + delta + candidates.length) % candidates.length;
  candidates[next].focus();
}

function performDefault(target, message) {
  if (editTextControl(target, message) || editContentEditable(target, message)) return;
  if (message.key === 'Tab') {
    moveFocus(Boolean(message.shiftKey));
    return;
  }
  if ((message.key === 'Enter' || message.key === ' ') && target instanceof HTMLElement
      && target.matches('button,a[href],[role="button"],input[type="button"],input[type="submit"]')) {
    target.click();
    return;
  }
  const scroll = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0] }[message.key];
  if (scroll && (target === document.body || target === document.documentElement)) {
    window.scrollBy?.(...scroll);
  }
}

export function dispatchPortalHidMessage(message) {
  if (!validMessage(message)) return false;
  const target = eventTarget();
  const event = new KeyboardEvent(message.action === 'down' ? 'keydown' : 'keyup', {
    key: message.key,
    code: message.code,
    location: Number(message.location) || 0,
    ctrlKey: Boolean(message.ctrlKey),
    shiftKey: Boolean(message.shiftKey),
    altKey: Boolean(message.altKey),
    metaKey: Boolean(message.metaKey),
    repeat: Boolean(message.repeat),
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'portalHid', { value: true, configurable: false });
  target.dispatchEvent(event);
  if (message.action === 'down' && !event.defaultPrevented) performDefault(target, message);
  return true;
}

export function usePortalHidKeyboard({ enabled = true, port = DEFAULT_PORT } = {}) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('WebSocket' in window)) return undefined;
    let ws;
    let timer;
    let stopped = false;
    let retryMs = RECONNECT_MIN_MS;
    const url = `ws://127.0.0.1:${port}/`;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };
    const connect = () => {
      if (stopped) return;
      try { ws = new WebSocket(url); } catch { schedule(); return; }
      ws.onopen = () => {
        retryMs = RECONNECT_MIN_MS;
        logger().info('portal-hid-connected', { url });
      };
      ws.onmessage = (event) => {
        try { dispatchPortalHidMessage(JSON.parse(event.data)); } catch { /* malformed input is inert */ }
      };
      ws.onerror = () => { };
      ws.onclose = schedule;
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        try { ws.close(); } catch { /* already closed */ }
      }
    };
  }, [enabled, port]);
}

export default usePortalHidKeyboard;
