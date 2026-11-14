// bridgeMidiTap.js — read what the KEYBOARD sent, on the kiosk.
//
// On the tablet Chromium holds no Web MIDI at all (useWebMidiBLE relinquishes it
// when the bridge owns OUT — a second GATT client caused the 2026-08 one-way
// outage), and the bridge WebSocket only fans out notes. So Program Change and
// Bank Select coming FROM the piano are invisible to the page, except here: the
// bridge APK keeps the last 64 raw chunks its read port received, untouched by
// parsing, at GET /midi/tap (BridgeCore.tapMidiIn). Polling that is passive — it
// opens nothing on the BLE link.
//
// Snapshot shape: { tap: { chunks, bytes, runningStatusUses, recent: ["<ms%100000> B0 00 00", …] } }
// `chunks` is a running total, so the number of NEW chunks since the last poll is
// the difference; `recent` holds at most 64, oldest first.
//
// Pure parsing + diffing here; the polling hook is useBridgeMidiTap.

export const TAP_URL = 'http://localhost:8770/midi/tap';
export const TAP_WINDOW = 64;

/** One tap line → array of byte values (the leading ms field dropped). */
export function chunkBytes(line) {
  const parts = String(line || '').trim().split(/\s+/);
  return parts.slice(1).map((h) => parseInt(h, 16)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

/**
 * Split a chunk into MIDI channel messages, honouring running status carried
 * across chunks in `state.status`. System/realtime bytes are skipped.
 */
export function splitMessages(bytes, state = { status: 0 }) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let status = bytes[i];
    let d;
    if (status >= 0xf8) { i += 1; continue; }
    if (status < 0x80) {
      if (state.status >= 0x80 && state.status < 0xf0) { status = state.status; d = i; } else { i += 1; continue; }
    } else if (status >= 0xf0) { state.status = 0; i += 1; continue; } else { state.status = status; d = i + 1; }
    const hi = status & 0xf0;
    const n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
    if (d + n > bytes.length) break;
    out.push([status, ...bytes.slice(d, d + n)]);
    i = d + n;
  }
  return out;
}

/**
 * Chunks that arrived since `prevTotal`. A first poll (prevTotal null) returns
 * none: the panel shows what happens AFTER it opens, not stale history.
 */
export function newChunks(snapshot, prevTotal) {
  const total = Number(snapshot?.chunks);
  const recent = Array.isArray(snapshot?.recent) ? snapshot.recent : [];
  if (!Number.isFinite(total)) return { total: prevTotal, lines: [] };
  if (prevTotal == null || total < prevTotal) return { total, lines: [] }; // first look, or the bridge restarted
  const fresh = Math.min(total - prevTotal, recent.length);
  return { total, lines: fresh > 0 ? recent.slice(-fresh) : [] };
}

/**
 * Fold messages into voice changes. Bank Select is channel state: CC0/CC32 are
 * remembered per channel and stamped onto the next Program Change.
 * @returns {{ ch:number, msb:number, lsb:number, pc:number }[]}  ch is 1-based
 */
export function voiceChanges(messages, banks = {}) {
  const out = [];
  for (const [status, a, b] of messages) {
    const hi = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    const bank = banks[ch] || (banks[ch] = { msb: 0, lsb: 0 });
    if (hi === 0xb0 && a === 0) bank.msb = b;
    else if (hi === 0xb0 && a === 32) bank.lsb = b;
    else if (hi === 0xc0) out.push({ ch, msb: bank.msb, lsb: bank.lsb, pc: a });
  }
  return out;
}

/**
 * Collapse repeats: the piano's echo and the BLE flush re-send make one press
 * arrive as several identical changes within a few hundred ms.
 */
export function dedupeChanges(changes, last = null, now = Date.now(), windowMs = 1500) {
  const out = [];
  let prev = last;
  for (const c of changes) {
    if (prev && prev.msb === c.msb && prev.lsb === c.lsb && prev.pc === c.pc && now - prev.at < windowMs) continue;
    prev = { ...c, at: now };
    out.push(prev);
  }
  return { changes: out, last: prev };
}
