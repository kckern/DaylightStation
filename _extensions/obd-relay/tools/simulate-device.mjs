#!/usr/bin/env node
// =============================================================================
// simulate-device.mjs — pretend to be the in-car Freematics device.
//
// Connects to the backend event bus as a WS device client and replays the same
// message sequence the firmware sends (hello → wifi-joined → chunked trip →
// snapshots), then waits for the backend's trip-ack. Lets the whole
// backend/persistence pipeline be exercised before the hardware arrives.
// Exit 0 = trip-ack received; exit 1 = timeout/failure.
//
// Usage (against a running dev backend):
//   node tools/simulate-device.mjs --host localhost --port 3112 --id family-car
//   [--samples 600] [--chunk 300] [--away]   (--away = boot-relative clock trip)
//
// Uses the repo root's `ws` package — run from within the repo.
// =============================================================================
import WebSocket from 'ws';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const host = arg('host', 'localhost');
const port = Number(arg('port', 3112));
const id = arg('id', 'family-car');
const nSamples = Number(arg('samples', 600));
const chunkSize = Number(arg('chunk', 300));
const away = has('away'); // trip started away from home: no wall clock at start

const SOURCE = 'obd-relay';
const tripId = `sim-${Date.now().toString(36)}`;
const bootMs = 120_000; // pretend we booted 2 min ago
const url = `ws://${host}:${port}/ws`;

console.log(`[sim] connecting ${url} as vehicle=${id} trip=${tripId} (${nSamples} samples${away ? ', away-clock' : ''})`);
const ws = new WebSocket(url);
const send = (obj) => ws.send(JSON.stringify({ source: SOURCE, id, ...obj }));

// fabricate a drive: gentle loop near Seattle, speed/rpm sine
const samples = Array.from({ length: nSamples }, (_, i) => {
  const t = bootMs + i * 1000;
  const ph = i / nSamples;
  return [
    t,
    Number((47.60 + 0.02 * Math.sin(ph * 6.28)).toFixed(5)),
    Number((-122.33 + 0.02 * Math.cos(ph * 6.28)).toFixed(5)),
    Math.max(0, Math.round(45 + 30 * Math.sin(ph * 12.56))), // speed_kph
    Math.round(900 + 2200 * Math.abs(Math.sin(ph * 12.56))), // rpm
    88,                                                       // coolant_c
    Math.round(63 - 4 * ph),                                  // fuel_pct
    14.2,                                                     // batt_v
  ];
});
const endedBoot = samples[samples.length - 1][0];

const timeout = setTimeout(() => {
  console.error('[sim] FAILED: no trip-ack within 15s');
  process.exit(1);
}, 15_000);

ws.on('open', () => {
  console.log('[sim] connected');
  send({ type: 'hello', fw: 'sim-0.1.0', rssi: -48, ts: Date.now() });
  send({ type: 'event', event: 'wifi-joined', ts: Date.now() });

  // chunked trip upload, firmware-style
  let seq = 0;
  for (let off = 0; off < samples.length; off += chunkSize) {
    const chunk = samples.slice(off, off + chunkSize);
    const final = off + chunkSize >= samples.length;
    const msg = { type: 'trip', trip_id: tripId, seq, final, samples: chunk };
    if (final) {
      msg.meta = {
        started_epoch_ms: away ? 0 : Date.now() - nSamples * 1000,
        time_approx: away,
        samples: samples.length,
        ended_boot_ms: endedBoot,
        upload_boot_ms: endedBoot + 5000,
        upload_epoch_ms: Date.now(),
        schema: 't,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v',
      };
    }
    send(msg);
    seq++;
  }
  console.log(`[sim] trip sent in ${seq} chunk(s) — awaiting ack`);

  // a couple of live snapshots for good measure
  send({ type: 'snapshot', battery_v: 14.2, fuel_pct: 59, coolant_c: 88, rpm: 840, speed_kph: 0, dtc: [], gps: { lat: 47.6, lon: -122.33, sats: 9 }, ts: Date.now() });
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg?.type === 'trip-ack' && msg.trip_id === tripId) {
    clearTimeout(timeout);
    console.log(`[sim] trip-ack received for ${tripId} — pipeline OK`);
    console.log(`[sim] check: <dataDir>/household/history/automotive/${id}/trips/${tripId}.yml`);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  clearTimeout(timeout);
  console.error(`[sim] FAILED: ${err.message} (is the dev backend running on ${host}:${port}?)`);
  process.exit(1);
});
