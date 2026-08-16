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

  // The gate that discarded the piano kiosk's entire event stream for months
  // did it without leaving a trace. A dropped event has to be countable.
  describe('drop accounting', () => {
    test('counts skipped events per app and reports them in getStatus', () => {
      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
      const sft = getSessionFileTransport();

      // Tagged with an app but never opted into session logging — the exact
      // shape of every event PianoApp emitted before it was tagged.
      sft.write({ ts: '2026-08-16T18:32:00.000', level: 'info', event: 'piano.video.open', data: {}, context: { app: 'piano-kiosk' } });
      sft.write({ ts: '2026-08-16T18:32:01.000', level: 'info', event: 'playback.player-remount', data: {}, context: { app: 'piano-kiosk' } });
      // No app at all.
      sft.write({ ts: '2026-08-16T18:32:02.000', level: 'info', event: 'anonymous', data: {}, context: {} });

      const status = sft.getStatus();
      expect(status.skipped.total).toBe(3);
      expect(status.skipped.byApp['piano-kiosk']).toBe(2);
      expect(status.skipped.byApp['(untagged)']).toBe(1);
    });

    test('separates "no app" from "app present but not session-logged"', () => {
      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
      const sft = getSessionFileTransport();

      sft.write({ ts: '2026-08-16T18:32:00.000', level: 'info', event: 'e1', data: {}, context: { app: 'piano-kiosk' } });
      sft.write({ ts: '2026-08-16T18:32:01.000', level: 'info', event: 'e2', data: {}, context: {} });

      const status = sft.getStatus();
      expect(status.skipped.byReason['not-session-logged']).toBe(1);
      expect(status.skipped.byReason['no-app']).toBe(1);
    });

    test('a written event is not counted as a skip', () => {
      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
      const sft = getSessionFileTransport();

      sft.write({ ts: '2026-08-16T18:32:00.000', level: 'info', event: 'kept', data: {}, context: { app: 'fitness', sessionLog: true } });

      expect(sft.getStatus().skipped.total).toBe(0);
    });

    // One warn line naming the first app dropped would have made the untagged
    // piano kiosk obvious months before the incident. Once per process, so a
    // storm cannot turn the diagnosis into its own flood.
    test('warns exactly once, naming the first app dropped', () => {
      resetLogging();
      initializeLogging({ defaultLevel: 'debug' });
      const captured = [];
      getDispatcher().addTransport({ name: 'capture', send: (e) => captured.push(e) });

      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
      const sft = getSessionFileTransport();

      sft.write({ ts: '2026-08-16T18:32:00.000', level: 'info', event: 'e1', data: {}, context: { app: 'piano-kiosk' } });
      sft.write({ ts: '2026-08-16T18:32:01.000', level: 'info', event: 'e2', data: {}, context: { app: 'piano-kiosk' } });
      sft.write({ ts: '2026-08-16T18:32:02.000', level: 'info', event: 'e3', data: {}, context: { app: 'school' } });

      const warns = captured.filter((e) => e.event === 'logging.session-file.untagged');
      expect(warns).toHaveLength(1);
      expect(warns[0].level).toBe('warn');
      expect(warns[0].data.app).toBe('piano-kiosk');
      expect(warns[0].data.reason).toBe('not-session-logged');
      expect(warns[0].data.droppedEvent).toBe('e1');
      expect(sft.getStatus().skipped.warned).toBe(true);

      resetLogging();
    });
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

    // Pruning used to happen only inside init, which meant retention was
    // really "maxAgeDays as of the last container restart" — unbounded on a
    // long-lived process. A file that ages past the window while the server is
    // up has to go without anyone restarting anything.
    test('prunes on a recurring timer, not only at init', () => {
      vi.useFakeTimers();
      try {
        const appDir = path.join(tmpDir, 'piano-kiosk');
        fs.mkdirSync(appDir, { recursive: true });
        const file = path.join(appDir, '2026-08-16T10-00-00.jsonl');
        fs.writeFileSync(file, '{"event":"incident"}\n');

        // Fresh at boot, so the init-time prune must leave it alone.
        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
        expect(fs.existsSync(file)).toBe(true);

        // Age it past retention without re-initializing the transport.
        const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
        fs.utimesSync(file, new Date(fiveDaysAgo), new Date(fiveDaysAgo));

        vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

        expect(fs.existsSync(file)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    // media/logs is the sanctioned home for heavy logs, and it holds more than
    // logs: pose recordings, a camera event archive, .events telemetry, .webm
    // captures, loose screenshots. A recursive pruner that goes by extension
    // alone would delete other features' data.
    describe('nested layouts', () => {
      const aged = (file) => {
        const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
        fs.utimesSync(file, new Date(old), new Date(old));
      };
      const write = (rel, contents) => {
        const file = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
        aged(file);
        return file;
      };

      // What the transport itself writes: one dispatcher event per line.
      const SESSION_LINE = JSON.stringify({
        ts: '2026-07-01T10:00:00.000Z', level: 'info', event: 'piano.video.open',
        data: {}, context: { app: 'piano-kiosk', sessionLog: true },
      }) + '\n';

      test('prunes an aged session log one directory deeper than the app dir', () => {
        const nested = write('piano-kiosk/2026-07-01/2026-07-01T10-00-00.jsonl', SESSION_LINE);

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(nested)).toBe(false);
      });

      test('leaves a nested session log that is still inside the window', () => {
        const file = path.join(tmpDir, 'piano-kiosk/2026-07-01/fresh.jsonl');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, SESSION_LINE);

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(file)).toBe(true);
      });

      // Real prod data: media/logs/poses/<date>/*.jsonl, pose-estimation
      // recordings that happen to share the extension AND the filename shape.
      test('leaves nested .jsonl that another feature owns (pose recordings)', () => {
        const poses = write(
          'poses/2026-03-04/2026-03-04T06-11-23.jsonl',
          '{"type":"session_start","ts":1772604739323,"backend":"cpu"}\n',
        );

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(poses), 'deleted a pose recording').toBe(true);
      });

      // Real prod data: media/logs/camera-archive/<camera>/<date>.jsonl.
      test('leaves nested .jsonl that another feature owns (camera archive)', () => {
        const archive = write(
          'camera-archive/driveway-camera/2026-08-03.jsonl',
          '{"ts":"2026-08-03T06:59:59.000Z","camera":"driveway-camera","labels":[]}\n',
        );

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(archive), 'deleted a camera archive entry').toBe(true);
      });

      test('leaves files this transport does not write, whatever their age', () => {
        const events = write('piano-kiosk/2026-07-01/input.events', 'anything\n');
        const webm = write('brain/effect-audit/2026-07-01/clip.webm', 'binary\n');
        const png = write('screenshot.png', 'binary\n');

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(events), 'deleted .events (a different transport, 30-day retention)').toBe(true);
        expect(fs.existsSync(webm)).toBe(true);
        expect(fs.existsSync(png), 'deleted a file sitting directly in the logs root').toBe(true);
      });

      test('removes files, never directories', () => {
        write('piano-kiosk/2026-07-01/2026-07-01T10-00-00.jsonl', SESSION_LINE);

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(path.join(tmpDir, 'piano-kiosk/2026-07-01'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'piano-kiosk'))).toBe(true);
      });

      // An unbounded walk over a media directory is its own hazard.
      test('stops at two directory levels below the root', () => {
        const tooDeep = write('piano-kiosk/2026-07-01/extra/2026-07-01T10-00-00.jsonl', SESSION_LINE);

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(tooDeep)).toBe(true);
      });

      test('does not follow a symlinked directory out of the tree', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
        const victim = path.join(outside, '2026-07-01T10-00-00.jsonl');
        fs.writeFileSync(victim, SESSION_LINE);
        aged(victim);
        fs.mkdirSync(path.join(tmpDir, 'piano-kiosk'), { recursive: true });
        fs.symlinkSync(outside, path.join(tmpDir, 'piano-kiosk', 'elsewhere'), 'dir');

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(victim), 'followed a symlink out of the log tree').toBe(true);
        fs.rmSync(outside, { recursive: true, force: true });
      });

      test('still prunes the flat app-dir layout it always did', () => {
        const flat = write('fitness/2026-07-01T10-00-00.jsonl', SESSION_LINE);

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 14 });

        expect(fs.existsSync(flat)).toBe(false);
      });
    });

    test('resetSessionFileTransport stops the prune timer', () => {
      vi.useFakeTimers();
      try {
        const appDir = path.join(tmpDir, 'piano-kiosk');
        fs.mkdirSync(appDir, { recursive: true });
        const file = path.join(appDir, '2026-08-16T10-00-00.jsonl');
        fs.writeFileSync(file, '{"event":"incident"}\n');

        initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        resetSessionFileTransport();

        const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
        fs.utimesSync(file, new Date(fiveDaysAgo), new Date(fiveDaysAgo));

        vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);

        // A released transport must not still be deleting files behind us.
        expect(fs.existsSync(file)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
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
