#!/usr/bin/env node

// Generates the synthetic JamCorder recording used by the harvest / archive /
// stone-parser tests. Deterministic: re-running rewrites the same bytes.
//
//   node tests/fixtures/jamcorder/make-jamcorder-fixture.mjs
//
// A JamCorder file is a format-0 Standard MIDI File whose single track opens
// with a sequencer-specific meta event (FF 7F) carrying `jmxStoneHdr{...}` - a
// tab-indented JSON header holding the recording time, the device and
// performer identities, and the asset index. `parseMidiRecordingStone` reads
// exactly that, so the header below mirrors the real firmware's field layout
// with invented values (made-up device, uuids and date). The rest of the track
// is a short two-handed pattern so the file is still playable MIDI.

import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'Jmx-A00005-Jan-02-2001.mid');

const TPQN = 480;

// 2001-01-02 18:17:40 at UTC-8 (localOffset is minutes east of UTC).
const UNIXTIME = Date.UTC(2001, 0, 3, 2, 17, 40) / 1000;
const header = {
  jmxVersion: '1.0',
  stoneIdx: 1,
  stoneUuid: '00000000-0000-4000-8000-0000000000a1',
  time: { timeSource: 'sntp', unixtime: UNIXTIME, localOffset: -480 },
  asset: {
    assetIdx: 5,
    assetUuid: '00000000-0000-4000-8000-0000000000a5',
    midiPath: '/JAMC/2001/00000000-0000-4000-8000-0000000000b1/Jmx-A00005-Jan-02-2001.mid',
  },
  identities: {
    jamcorderUuid: '00000000-0000-4000-8000-0000000000b1',
    jamcorderName: 'Test Piano',
    performerUuid: '00000000-0000-4000-8000-0000000000c1',
    performerName: 'Test Performer',
  },
  position: { fileOffset: 22, msgOffset: 0, tmptOffset: 0 },
  tempo: { tpqn: TPQN, mpqn: 500000 },
  sound: { state: 'silent', dur: 999999999 },
  notes: {},
};

const vlq = (n) => {
  const bytes = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
  return Buffer.from(bytes);
};

// JSON.stringify with tabs, then `"key":\tvalue` as the firmware writes it.
const headerText = `jmxStoneHdr${JSON.stringify(header, null, '\t').replace(/": /g, '":\t')}`;
const headerPayload = Buffer.concat([Buffer.from([0x00]), Buffer.from(headerText, 'latin1')]);

const events = [Buffer.concat([Buffer.from([0x00, 0xff, 0x7f]), vlq(headerPayload.length), headerPayload])];
// Tempo, then a C-major arpeggio over a held bass note, repeated.
events.push(Buffer.from([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]));
const note = (delta, key, vel) => Buffer.concat([vlq(delta), Buffer.from([0x90, key, vel])]);
const off = (delta, key) => Buffer.concat([vlq(delta), Buffer.from([0x80, key, 0])]);
for (let bar = 0; bar < 4; bar += 1) {
  events.push(note(bar === 0 ? 0 : 240, 48, 70));
  for (const key of [60, 64, 67, 72, 67, 64]) {
    events.push(note(0, key, 80));
    events.push(off(TPQN / 2, key));
    // next note's on-event carries delta 0 above
  }
  events.push(off(0, 48));
}
events.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));

const track = Buffer.concat(events);
const head = Buffer.alloc(14);
head.write('MThd', 0, 'latin1');
head.writeUInt32BE(6, 4);
head.writeUInt16BE(0, 8); // format 0
head.writeUInt16BE(1, 10); // one track
head.writeUInt16BE(TPQN, 12);
const trkHead = Buffer.alloc(8);
trkHead.write('MTrk', 0, 'latin1');
trkHead.writeUInt32BE(track.length, 4);

writeFileSync(OUT, Buffer.concat([head, trkHead, track]));
console.log(`wrote ${OUT} (${14 + 8 + track.length} bytes, unixtime ${UNIXTIME})`);
