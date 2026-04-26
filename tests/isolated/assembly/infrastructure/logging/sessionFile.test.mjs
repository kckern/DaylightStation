import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initSessionFileTransport,
  getSessionFileTransport,
  resetSessionFileTransport
} from '#backend/src/0_system/logging/transports/sessionFile.mjs';
import { ingestFrontendLogs } from '#backend/src/0_system/logging/ingestion.mjs';
import {
  initializeLogging,
  resetLogging,
  getDispatcher
} from '#backend/src/0_system/logging/dispatcher.mjs';

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

  describe('retention pruning', () => {
    test('deletes files older than maxAgeDays on init', () => {
      // Create app dir with an old file
      const appDir = path.join(tmpDir, 'fitness');
      fs.mkdirSync(appDir, { recursive: true });
      const oldFile = path.join(appDir, '2026-02-20T10-00-00.jsonl');
      fs.writeFileSync(oldFile, '{"event":"old"}\n');

      // Backdate the file to 5 days ago
      const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
      fs.utimesSync(oldFile, new Date(fiveDaysAgo), new Date(fiveDaysAgo));

      // Create a recent file
      const newFile = path.join(appDir, '2026-02-24T10-00-00.jsonl');
      fs.writeFileSync(newFile, '{"event":"new"}\n');

      // Init triggers pruning with 3-day max
      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    test('ignores non-jsonl files during pruning', () => {
      const appDir = path.join(tmpDir, 'fitness');
      fs.mkdirSync(appDir, { recursive: true });
      const readmeFile = path.join(appDir, 'README.md');
      fs.writeFileSync(readmeFile, 'keep me');

      // Backdate it
      const oldDate = Date.now() - 10 * 24 * 60 * 60 * 1000;
      fs.utimesSync(readmeFile, new Date(oldDate), new Date(oldDate));

      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

      expect(fs.existsSync(readmeFile)).toBe(true);
    });
  });
});

describe('ingestion integration', () => {
  let tmpDir;

  beforeEach(() => {
    resetSessionFileTransport();
    resetLogging();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-ingest-'));
  });

  afterEach(() => {
    const sft = getSessionFileTransport();
    if (sft) sft.flush();
    resetSessionFileTransport();
    resetLogging();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ingestFrontendLogs writes to session file when sessionLog context is set', () => {
    // Set up dispatcher (required for ingestion)
    initializeLogging({ defaultLevel: 'debug' });
    const mockTransport = { name: 'mock', send: vi.fn() };
    getDispatcher().addTransport(mockTransport);

    // Set up session file transport
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

    // Ingest a session-log.start event
    ingestFrontendLogs({
      events: [
        {
          ts: '2026-02-24T16:00:00.000',
          level: 'info',
          event: 'session-log.start',
          data: {},
          context: { app: 'admin', sessionLog: true }
        },
        {
          ts: '2026-02-24T16:00:01.000',
          level: 'info',
          event: 'admin-page-loaded',
          data: { page: 'config' },
          context: { app: 'admin', sessionLog: true }
        }
      ]
    });

    // Normal dispatch should still work
    expect(mockTransport.send).toHaveBeenCalledTimes(2);

    // Session file should also have been written
    const appDir = path.join(tmpDir, 'admin');
    expect(fs.existsSync(appDir)).toBe(true);
    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);

    const content = fs.readFileSync(path.join(appDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
