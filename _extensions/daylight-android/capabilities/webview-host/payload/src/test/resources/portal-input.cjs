const assert = require('node:assert/strict');
const shim = require('node:fs').readFileSync(0, 'utf8');
const vm = require('node:vm');
const listeners = new Map(), timers = new Set(), owners = new Map(), frames = new Map();
let generation = 1;
const page = {
  setInterval(fn) { timers.add(fn); return fn; },
  clearInterval(fn) { timers.delete(fn); },
  addEventListener(name, fn) { listeners.set(name, fn); },
  removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  __daylightNative: {
    open(key, frame) { assert.equal(key, 'test-key'); assert.equal(frame, 'top'); return String(generation); },
    call(token, method) {
      if (token !== String(generation)) return '';
      if (method === 'currentPage') return 'true';
      const [, channel, op] = /^(portalVolume|portalKeyboard)(Subscribe|Unsubscribe|Read)$/.exec(method);
      if (op === 'Subscribe') { owners.set(channel, token); return 'true'; }
      if (owners.get(channel) !== token) return '';
      if (op === 'Unsubscribe') { owners.delete(channel); return 'true'; }
      const result = frames.get(channel) || [];
      frames.delete(channel);
      return JSON.stringify(result);
    },
  },
};
page.window = page.top = page;
vm.runInNewContext(shim, page);
let typed = '', volume = 0;
const input = page.daylight.portal;
const dropped = input.subscribeKeyboard(() => { throw Error('replaced callback'); });
const oldRead = listeners.get('daylight:portalkeyboardready');
const keyboard = input.subscribeKeyboard(key => { typed += key.key; });
const buttons = input.subscribeVolume(key => { if (key.code === 'VolumeUp') volume++; });
dropped(); oldRead();
frames.set('portalVolume', [{code:'VolumeUp'}]);
frames.set('portalKeyboard', [{key:'a'}]);
listeners.get('daylight:portalvolumeready')();
listeners.get('daylight:portalkeyboardready')();
listeners.get('daylight:portalkeyboardready')();
assert.equal(typed, 'a');
assert.equal(volume, 1);
generation++; owners.clear();
for (const timer of timers) timer();
frames.set('portalKeyboard', [{key:'b'}]);
listeners.get('daylight:portalkeyboardready')();
assert.equal(typed, 'ab');
keyboard(); buttons();
assert.equal(listeners.size + timers.size + owners.size, 0);
