#!/usr/bin/env node
// =============================================================================
// pair-scanner.mjs — drive the DS6878 SSP pairing dance from one command.
//
// The scanner is a HID keyboard-class device: it requires an MITM-authenticated
// link key and drops the HID channel ~16 ms after open if it only gets a
// "Just Works" (unauthenticated) one. So the ESP declares DisplayOnly, SSP
// negotiates Passkey Entry, and the 6-digit passkey has to be keyed into the
// scanner by scanning digit bar codes — inside the ~30 s LMP timeout.
//
// This script clears the old bond, triggers the connect, then polls until the
// passkey appears and prints it big so you can start scanning immediately.
//
// PREREQ (one-time, on the scanner):
//   1. "Bluetooth Keyboard Emulation (HID Slave)"  — PRG p.4-5
//   2. "Variable PIN Code"                         — PRG p.4-30
//   Cropped bar codes: ~/Downloads/DS6878-SCAN-THIS-*.png
//   Digits 0-9 + End of Message: ~/Downloads/DS6878-PASSKEY-DIGITS-{476,477}.png
//
// Usage:
//   node tools/pair-scanner.mjs [host]          # default 10.0.0.47
//   node tools/pair-scanner.mjs --keep-bond     # don't unbond first
// =============================================================================
const host = process.argv.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || '10.0.0.47';
const keepBond = process.argv.includes('--keep-bond');

const get = async (path) => {
  const res = await fetch(`http://${host}${path}`, { signal: AbortSignal.timeout(5000) });
  return res.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const big = (code) => {
  const line = '='.repeat(46);
  console.log(`\n${line}\n   SCAN THESE DIGITS ON THE SCANNER NOW:\n\n        >>>  ${code.split('').join('  ')}  <<<\n\n   then scan "End of Message"\n${line}\n`);
};

try {
  const before = await get('/status');
  console.log(`[pair] ${host} up ${before.uptime_s}s, iocap=${before.barcode.iocap}, bonds=${before.barcode.bonds}`);
  if (before.barcode.iocap !== 'display') {
    console.log('[pair] switching io-cap to DisplayOnly (required for passkey entry)');
    await get('/barcode/iocap?mode=display');
  }
  if (before.barcode.mode !== 'paging') {
    console.log('[pair] enabling paging (scanner is a HID slave — the host connects)');
    await get('/barcode/mode?passive=0');
  }
  if (!keepBond) {
    await get('/barcode/unbond');
    console.log('[pair] cleared stored bond');
  }

  await get('/barcode/connect');
  console.log('[pair] connect requested — waiting for passkey (pull the scanner trigger if idle)...');

  let shown = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    let s;
    try { s = await get('/status'); } catch { continue; }   // ESP busy paging
    const b = s.barcode;

    if (b.passkey && b.passkey !== shown && b.passkey_age_s <= 3) {
      shown = b.passkey;
      big(b.passkey);
    }
    if (b.connected) {
      console.log(`[pair] ✅ CONNECTED — bonds=${b.bonds}. Scan a product bar code to confirm data flows.`);
      process.exit(0);
    }
    if (i % 10 === 9) console.log(`[pair] ...${i + 1}s  connected=${b.connected} last=${b.last_event || '-'}`);
  }
  console.log('[pair] ⏱  gave up after 90s. Re-run; if the passkey never appeared, confirm the scanner is');
  console.log('[pair]    in HID Slave mode and awake (trigger pull). If auth fails, you were too slow — retry.');
  process.exit(1);
} catch (err) {
  console.error(`[pair] ERROR talking to ${host}: ${err.message}`);
  process.exit(1);
}
