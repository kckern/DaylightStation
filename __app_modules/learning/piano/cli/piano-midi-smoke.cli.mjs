#!/usr/bin/env node
// Small hardware-in-the-loop MIDI smoke test.
//
// Dry-run is the default. Pass --send only when a recorder is running and the
// bridge endpoint is the intended piano. The sequence is deliberately short:
// drum marker (channel 10), Acoustic Grand (channel 1), three notes, then a
// final drum marker and all-notes-off.

const host = process.env.PB_HOST || '10.0.0.245:8770';
const base = `http://${host}`;
const send = process.argv.includes('--send');
const mini = process.argv.includes('--mini');
const sweep = process.argv.includes('--sweep');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function midi(hex) {
  if (!send) {
    console.log(`would send: ${hex}`);
    return;
  }
  const response = await fetch(`${base}/midi/send`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: hex,
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  console.log(`sent: ${hex}  ${body}`);
}

async function note(channel, noteNumber, velocity, durationMs) {
  const status = (0x90 | (channel & 0x0f)).toString(16).padStart(2, '0');
  const off = (0x80 | (channel & 0x0f)).toString(16).padStart(2, '0');
  await midi(`${status} ${noteNumber.toString(16)} ${velocity.toString(16)}`);
  await wait(durationMs);
  await midi(`${off} ${noteNumber.toString(16)} 00`);
}

async function marker(compact = false) {
  // GM channel 10: kick, snare, closed hat, snare, kick.
  const hits = compact ? [[36, 60], [38, 60], [42, 0]] : [[36, 100], [38, 100], [42, 100], [38, 100], [36, 0]];
  for (const [n, gap] of hits) {
    await note(9, n, 110, compact ? 40 : 70);
    await wait(gap);
  }
  await wait(compact ? 250 : 1000);
}

async function main() {
  console.log(`${send ? 'LIVE' : 'DRY RUN'} ${sweep ? '128-voice sweep' : mini ? 'mini ' : ''}piano MIDI smoke test via ${base}`);
  if (sweep) {
    await marker(); await wait(500);
    for (let pc = 0; pc < 128; pc++) {
      // Bank state is sticky. Reassert GM bank 0 for every sample so a prior
      // variation-bank selection cannot contaminate the acoustic mapping.
      await midi('b0 00 00');
      await midi('b0 20 00');
      await midi(`c0 ${pc.toString(16).padStart(2, '0')}`);
      await wait(500);
      await note(0, 60, 100, 500);
      await wait(1000);
      if ((pc + 1) % 10 === 0 && pc < 127) await marker();
    }
    await marker();
    await midi('b0 7b 00'); await midi('b9 7b 00');
    console.log('128-voice sweep complete');
    return;
  }
  await marker(mini);
  await midi('b0 00 00');
  await midi('b0 20 00');
  await midi('c0 00'); // channel 1, Program Change 0 = Acoustic Grand
  await wait(mini ? 200 : 500);
  for (const n of [60, 64, 67]) {
    await note(0, n, 100, mini ? 150 : 400);
    await wait(mini ? 80 : 250);
  }
  await marker(mini);
  await midi('b0 7b 00'); // channel 1, All Notes Off
  await midi('b9 7b 00'); // channel 10, All Notes Off
  console.log('smoke test complete');
}

main().catch((error) => {
  console.error(`smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
