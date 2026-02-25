import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initSessionFileTransport,
  getSessionFileTransport,
  resetSessionFileTransport
} from '#backend/src/0_system/logging/transports/sessionFile.mjs';

describe('SessionFileTransport', () => {
  let tmpDir;

  beforeEach(() => {
    resetSessionFileTransport();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-test-'));
  });

  afterEach(() => {
    const sft = getSessionFileTransport();
    if (sft) sft.flush();
    resetSessionFileTransport();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('write after session-log.start creates file and appends event', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: { app: 'fitness' },
      context: { app: 'fitness', sessionLog: true }
    });

    sft.write({
      ts: '2026-02-24T16:00:01.000',
      level: 'info',
      event: 'fitness-app-mount',
      data: { foo: 'bar' },
      context: { app: 'fitness', sessionLog: true }
    });

    const appDir = path.join(tmpDir, 'fitness');
    expect(fs.existsSync(appDir)).toBe(true);

    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.jsonl$/);

    const content = fs.readFileSync(path.join(appDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('session-log.start');
    expect(JSON.parse(lines[1]).event).toBe('fitness-app-mount');
  });

  test('events without prior session-log.start auto-create a session', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'some-event',
      data: {},
      context: { app: 'admin', sessionLog: true }
    });

    const appDir = path.join(tmpDir, 'admin');
    expect(fs.existsSync(appDir)).toBe(true);
    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);
  });

  test('new session-log.start closes previous session and opens new file', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    sft.write({
      ts: '2026-02-24T16:05:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    const appDir = path.join(tmpDir, 'fitness');
    const files = fs.readdirSync(appDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  test('different apps get separate subdirectories', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'admin', sessionLog: true }
    });

    expect(fs.existsSync(path.join(tmpDir, 'fitness'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'admin'))).toBe(true);
  });

  test('events without sessionLog context are ignored', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'random-event',
      data: {},
      context: { app: 'fitness' }
    });

    const entries = fs.readdirSync(tmpDir);
    expect(entries).toHaveLength(0);
  });

  test('getStatus returns active session info', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    const statusBefore = sft.getStatus();
    expect(statusBefore.name).toBe('session-file');
    expect(statusBefore.sessions).toEqual({});

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    const statusAfter = sft.getStatus();
    expect(statusAfter.sessions.fitness).toBeDefined();
    expect(statusAfter.sessions.fitness.writable).toBe(true);
  });
});
