import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initSessionEventsFileTransport,
  getSessionEventsFileTransport,
  resetSessionEventsFileTransport,
} from '../../../../backend/src/0_system/logging/transports/sessionEventsFile.mjs';

let baseDir;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  initSessionEventsFileTransport({ baseDir, maxAgeDays: 30 });
});
afterEach(() => { resetSessionEventsFileTransport(); fs.rmSync(baseDir, { recursive: true, force: true }); });

describe('sessionEventsFile transport', () => {
  it('writes a .events file with header then batch lines', () => {
    const t = getSessionEventsFileTransport();
    const app = 'piano-sheetmusic';
    t.write({ event: 'input.header', context: { app, channel: 'input' },
      data: { h: 1, session: '2026-07-22T15-57-08', score: 'x.mxl', ctx: {}, kinds: {}, strings: [] } });
    t.write({ event: 'input.batch', context: { app, channel: 'input' },
      data: { b: [[10, 1, 72, 88, 0, 0]], dropped: 0 } });
    t.flush();
    const file = path.join(baseDir, app, '2026-07-22T15-57-08.events');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).h).toBe(1);
    expect(JSON.parse(lines[1]).b[0][2]).toBe(72);
  });
});
