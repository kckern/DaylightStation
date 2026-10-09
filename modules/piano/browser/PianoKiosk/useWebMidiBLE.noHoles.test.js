import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * THE NO-HOLES GUARD.
 *
 * Three times in one day a MIDI OUT path shipped that wrote straight to the
 * browser's Web MIDI handle instead of the bridge's loopback-verified write
 * path, and each one failed the same way: the handle goes zombie, send()
 * "succeeds", the piano stays silent, and — because the call was a bare
 * `out.send(...)` — NOTHING is logged, so the failure is invisible.
 *
 *   1. voice / reverb / CC        (the original bridge-first pass fixed these)
 *   2. sendNoteAt / scheduleNotes (score playback: noteheads lit, piano mute)
 *   3. pressNote / releaseNote    (on-screen keys mute while playback worked)
 *
 * Each fix was correct and each left the next hole standing, because nothing
 * checked the CLASS of defect. This test does. It reads the hook's source and
 * asserts that every sender routes through the bridge helpers, so a 13th
 * sender added later fails here instead of failing silently at the piano.
 *
 * If this test fails you have added (or renamed) an outbound sender: route it
 * through `bridgeSendMidi` / `bridgeSendMidiAt` / `emitOut` and add it below.
 * Do not weaken the assertion — the silence it prevents has no other witness.
 */
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'useWebMidiBLE.js');
const src = readFileSync(HOOK, 'utf8');

/** Every outbound sender the hook exposes, and the routing each MUST have. */
const SENDERS = [
  'pressNote', 'releaseNote',
  'sendProgramChange', 'sendLocalControl', 'sendVoice', 'sendControlChange',
  'sendPanic', 'sendNote', 'sendNoteOff',
  'sendNoteAt', 'sendNoteOffAt', 'scheduleNotes',
];

/** Source text of one `const <name> = useCallback(...)` body. */
function bodyOf(name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) return null;
  const end = src.indexOf('\n  }, [', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

describe('useWebMidiBLE — no unrouted MIDI OUT holes', () => {
  it('every known sender still exists (a rename must not silently drop coverage)', () => {
    const missing = SENDERS.filter((s) => bodyOf(s) === null);
    expect(missing, `senders not found in the hook: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(SENDERS)('%s routes through the bridge before touching the Web MIDI handle', (name) => {
    const body = bodyOf(name);
    const routed = /bridgeSendMidiAt\(|bridgeSendMidi\(|emitOut\(|bridgeOutUp\(/.test(body);
    expect(routed, `${name} never calls a bridge helper — it writes straight to the zombie-prone Web MIDI handle`).toBe(true);
  });

  it('no sender uses the silent `outputRef.current?.send?.()` shape', () => {
    // Optional chaining on the SEND makes a missing/dead handle a no-op with no
    // log line at all — exactly how the on-screen keyboard went mute unnoticed.
    // Fallback sends inside a routed sender use a checked `out.send(...)`.
    // Strip comments first: the doc comments here quote the bad shape verbatim
    // to explain it, and prose must not trip a guard about executable code.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/outputRef\.current\?\.send\?\.\(/);
  });

  it('counts the senders, so a NEW one cannot be added without landing in this list', () => {
    const declared = [...src.matchAll(/const (\w+) = useCallback\(/g)].map((m) => m[1]);
    const senderish = declared.filter((n) => /^(send|press|release|schedule)/.test(n));
    const uncovered = senderish.filter((n) => !SENDERS.includes(n));
    expect(uncovered, `new outbound sender(s) not covered by this guard: ${uncovered.join(', ')}`).toEqual([]);
  });
});
