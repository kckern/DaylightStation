// Execute the exact generated document-start shim. A late navigation callback
// drops the subscription after document start but before its next heartbeat.
const assert = require('node:assert/strict');
const shim = require('node:fs').readFileSync(0, 'utf8');
const vm = require('node:vm');
const callbacks = new Map();
let timer, opens = 0, owner, delivered = 0;
const page = {
  location: { pathname: '/piano/lesson' },
  setInterval(fn) { timer = fn; return 1; }, clearInterval() {},
  addEventListener(name, fn) { callbacks.set(name, fn); },
  removeEventListener(name, fn) { if (callbacks.get(name) === fn) callbacks.delete(name); },
  __daylightNative: {
    open() { return 'document-' + ++opens; },
    call(token, method) {
      if (method === 'pianoSubscribe') { owner = token; return 'true'; }
      if (token !== owner) return '';
      if (method === 'pianoStatus') return '{"type":"status","midiInOpen":true}';
      if (method === 'pianoRead') return '[{"type":"note.on","note":64}]';
      if (method === 'pianoSend') return 'true';
      if (method === 'pianoUnsubscribe') owner = null;
      return '';
    },
  },
};
page.window = page.top = page;
vm.runInNewContext(shim, page);
const listen = frame => { if (frame.type === 'note.on') delivered++; };
const stop = page.daylight.piano.subscribe(listen);
assert.equal(owner, 'document-1');
const oldTimer = timer;
const oldRead = callbacks.get('daylight:midiready');
owner = null;
timer();
assert.equal(owner, 'document-2');
callbacks.get('daylight:midiready')();
assert.equal(delivered, 1);
assert.equal(page.daylight.piano.send([144, 64, 80], 120), true);
stop();
const stopNext = page.daylight.piano.subscribe(listen);
oldRead();
oldTimer();
stop();
assert.equal(delivered, 1);
callbacks.get('daylight:midiready')();
assert.equal(delivered, 2);
assert.equal(page.daylight.piano.send([128, 64, 0], 0), true);
stopNext();
