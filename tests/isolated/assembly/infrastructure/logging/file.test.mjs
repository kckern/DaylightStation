// tests/isolated/assembly/infrastructure/logging/file.test.mjs
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFileTransport } from '#backend/src/0_system/logging/transports/file.mjs';

const ANSI_PATTERN = /\x1b\[\d+m/;

describe('FileTransport', () => {
  let tmpDir;
  let transports;

  const makeEvent = (overrides = {}) => ({
    ts: '2026-06-09T10:00:00.000',
    level: 'info',
    event: 'test.event',
    data: { foo: 'bar' },
    context: { app: 'myApp', source: 'backend' },
    ...overrides
  });

  // Track transports so afterEach can flush (close streams) before rmdir
  const create = (options) => {
    const t = createFileTransport(options);
    transports.push(t);
    return t;
  };

  beforeEach(() => {
    transports = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-transport-test-'));
  });

  afterEach(async () => {
    for (const t of transports) {
      await t.flush();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    test('throws when filename is missing', () => {
      expect(() => createFileTransport()).toThrow(/requires a filename/);
      expect(() => createFileTransport({})).toThrow(/requires a filename/);
    });

    test('creates parent directory recursively when missing', () => {
      const filename = path.join(tmpDir, 'nested', 'deep', 'app.log');
      create({ filename });

      expect(fs.existsSync(path.join(tmpDir, 'nested', 'deep'))).toBe(true);
    });

    test('throws a descriptive error when directory creation fails', () => {
      const filename = path.join(tmpDir, 'blocked', 'app.log');
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => createFileTransport({ filename }))
        .toThrow(/Failed to create log directory/);
    });

    test('picks up existing file size for rotation accounting', () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(100));

      const transport = create({ filename });

      expect(transport.getStatus().currentSize).toBe(100);
    });

    test('survives a stat failure on the existing file (logs to stderr, size 0)', () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(100));
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(fs, 'statSync').mockImplementation(() => {
        throw new Error('EIO');
      });

      const transport = create({ filename });

      expect(transport.getStatus().currentSize).toBe(0);
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Failed to stat file'));
    });
  });

  describe('json format (default)', () => {
    test('appends one JSON line per event', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename });

      transport.send(makeEvent({ event: 'first' }));
      transport.send(makeEvent({ event: 'second', level: 'error' }));
      await transport.flush();

      const lines = fs.readFileSync(filename, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).event).toBe('first');
      expect(JSON.parse(lines[1])).toEqual(makeEvent({ event: 'second', level: 'error' }));
    });

    test('appends to pre-existing file content', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, '{"event":"pre-existing"}\n');
      const transport = create({ filename });

      transport.send(makeEvent({ event: 'new-event' }));
      await transport.flush();

      const lines = fs.readFileSync(filename, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).event).toBe('pre-existing');
      expect(JSON.parse(lines[1]).event).toBe('new-event');
    });

    test('unserializable event falls back to a log-format-error record instead of throwing', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename });

      const circular = makeEvent();
      circular.data.self = circular; // JSON.stringify throws on circular refs

      expect(() => transport.send(circular)).not.toThrow();
      await transport.flush();

      const line = fs.readFileSync(filename, 'utf-8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.event).toBe('log-format-error');
      expect(parsed.level).toBe('error');
    });
  });

  describe('pretty format', () => {
    test('includes ts, level, event, data, app and source context', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, format: 'pretty' });

      transport.send(makeEvent({
        ts: '2026-06-09T10:00:00.000',
        level: 'warn',
        event: 'rate.limit',
        data: { remaining: 5 },
        context: { app: 'fitness', source: 'backend' }
      }));
      await transport.flush();

      const content = fs.readFileSync(filename, 'utf-8');
      expect(content).toContain('[2026-06-09T10:00:00.000]');
      expect(content).toContain('[WARN ]');
      expect(content).toContain('rate.limit');
      expect(content).toContain('{"remaining":5}');
      expect(content).toContain('(fitness)');
      expect(content).toContain('<backend>');
      expect(content).not.toMatch(ANSI_PATTERN); // colorize defaults to false for files
    });

    test('missing level defaults to INFO', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, format: 'pretty' });

      transport.send(makeEvent({ level: undefined }));
      await transport.flush();

      expect(fs.readFileSync(filename, 'utf-8')).toContain('[INFO ]');
    });

    test('colorize true emits ANSI codes', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, format: 'pretty', colorize: true });

      transport.send(makeEvent({ level: 'error' }));
      await transport.flush();

      expect(fs.readFileSync(filename, 'utf-8')).toMatch(ANSI_PATTERN);
    });

    test('unserializable data degrades to a placeholder without throwing', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, format: 'pretty' });

      const event = makeEvent();
      event.data.self = event.data;

      expect(() => transport.send(event)).not.toThrow();
      await transport.flush();

      expect(fs.readFileSync(filename, 'utf-8')).toContain('[data serialization failed]');
    });
  });

  describe('rotation', () => {
    // Conventional logrotate scheme: live file -> .1 (newest), .1 -> .2, ...,
    // up to .{maxFiles - 1} (oldest), retaining exactly maxFiles generations
    // including the live file. Tests pre-seed the file on disk so the
    // constructor's statSync picks up an over-limit currentSize.

    test('rotates when maxSize is exceeded: live file becomes .1, new file starts at size 0', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250)); // already over maxSize on disk
      const transport = create({ filename, maxSize: 200, maxFiles: 3 });

      transport.send(makeEvent({ event: 'trigger-rotate' }));

      expect(fs.existsSync(`${filename}.1`)).toBe(true);
      expect(fs.existsSync(`${filename}.2`)).toBe(false);
      expect(transport.getStatus().currentSize).toBe(0);

      await transport.flush();
      expect(fs.readFileSync(`${filename}.1`, 'utf-8')).toContain('x'.repeat(250));
    });

    test('generations shift up (.1 -> .2) and the oldest is deleted at the maxFiles cap', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      fs.writeFileSync(`${filename}.1`, 'gen-newer\n');
      fs.writeFileSync(`${filename}.2`, 'gen-oldest\n'); // at cap for maxFiles: 3

      const transport = create({ filename, maxSize: 200, maxFiles: 3 });

      transport.send(makeEvent({ event: 'trigger-rotate' }));
      await transport.flush();

      // gen-oldest fell off the end; everything else shifted up one slot
      expect(fs.readFileSync(`${filename}.1`, 'utf-8')).toContain('x'.repeat(250));
      expect(fs.readFileSync(`${filename}.2`, 'utf-8')).toContain('gen-newer');
      expect(fs.existsSync(`${filename}.3`)).toBe(false);
    });

    test('maxFiles: 2 retains the live file plus a single .1 generation', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      fs.writeFileSync(`${filename}.1`, 'gen-old\n'); // at cap for maxFiles: 2

      const transport = create({ filename, maxSize: 200, maxFiles: 2 });

      transport.send(makeEvent({ event: 'trigger-rotate' }));
      await transport.flush();

      // gen-old was unlinked; live file took its slot
      const rotated = fs.readFileSync(`${filename}.1`, 'utf-8');
      expect(rotated).not.toContain('gen-old');
      expect(rotated).toContain('x'.repeat(250));
      expect(fs.existsSync(`${filename}.2`)).toBe(false);
    });

    test('maxFiles: 1 retains only the live file — the full generation is discarded', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      const transport = create({ filename, maxSize: 200, maxFiles: 1 });

      transport.send(makeEvent({ event: 'trigger-rotate' }));
      await transport.flush();

      expect(fs.existsSync(`${filename}.1`)).toBe(false);
      expect(fs.readFileSync(filename, 'utf-8')).not.toContain('x'.repeat(250));
    });

    test('first oversized write rotates correctly even before any data is flushed to disk', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, maxSize: 50, maxFiles: 3 });

      // No pre-seed, no wait for the stream: the very first send exceeds maxSize
      transport.send(makeEvent({ event: 'oversized', data: { pad: 'y'.repeat(100) } }));

      expect(fs.existsSync(`${filename}.1`)).toBe(true);
      expect(transport.getStatus().currentSize).toBe(0);

      await transport.flush();
      // The rotated-out stream flushes its buffered line into the renamed
      // generation (writes follow the fd/inode, not the path)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.readFileSync(`${filename}.1`, 'utf-8')).toContain('oversized');
      const live = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf-8') : '';
      expect(live).not.toContain('oversized'); // live file starts fresh
    });

    test('rotation failure does not throw into the app and keeps a writable stream', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const transport = create({ filename, maxSize: 200 });

      const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('EBUSY');
      });

      expect(() => {
        transport.send(makeEvent({ event: 'trigger-rotate' }));
      }).not.toThrow();

      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Rotation failed'));
      expect(transport.getStatus().writable).toBe(true);

      renameSpy.mockRestore();

      // Subsequent logs still land
      transport.send(makeEvent({ event: 'after-failure', data: {} }));
      await transport.flush();
      expect(fs.readFileSync(filename, 'utf-8')).toContain('after-failure');
    });

    test('rotation failure followed by stream-recreation failure still never throws', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const transport = create({ filename, maxSize: 200 });

      vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EBUSY'); });
      vi.spyOn(fs, 'createWriteStream').mockImplementation(() => { throw new Error('ENOSPC'); });

      expect(() => transport.send(makeEvent({ event: 'trigger-rotate' }))).not.toThrow();

      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Rotation failed'));
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Failed to recreate stream'));
    });
  });

  describe('write-error resilience', () => {
    test('a synchronous stream.write failure never throws into the app', () => {
      const filename = path.join(tmpDir, 'app.log');
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const fakeStream = {
        writable: true,
        on: vi.fn(),
        write: vi.fn(() => { throw new Error('disk full'); }),
        end: vi.fn((cb) => cb && cb())
      };
      vi.spyOn(fs, 'createWriteStream').mockReturnValue(fakeStream);

      const transport = create({ filename });

      expect(() => transport.send(makeEvent())).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Write failed: disk full'));
    });

    test('an async stream error event never crashes the process and is reported to stderr', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const createSpy = vi.spyOn(fs, 'createWriteStream');

      const transport = create({ filename });
      const realStream = createSpy.mock.results[0].value;

      // Without an 'error' listener this emit would throw (unhandled 'error'
      // event) and take the process down
      expect(() => realStream.emit('error', new Error('ENOSPC: no space left on device'))).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Stream error: ENOSPC'));

      // The dead stream is dropped; the transport reports not-writable
      expect(transport.getStatus().writable).toBe(false);

      // Subsequent sends fail soft: re-open and keep logging
      expect(() => transport.send(makeEvent({ event: 'after-stream-error' }))).not.toThrow();
      await transport.flush();
      expect(fs.readFileSync(filename, 'utf-8')).toContain('after-stream-error');
    });

    test('a stream error on a rotated-out (stale) stream does not drop the live stream', async () => {
      const filename = path.join(tmpDir, 'app.log');
      fs.writeFileSync(filename, 'x'.repeat(250));
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const createSpy = vi.spyOn(fs, 'createWriteStream');

      const transport = create({ filename, maxSize: 200, maxFiles: 3 });
      const firstStream = createSpy.mock.results[0].value;

      transport.send(makeEvent({ event: 'trigger-rotate' })); // rotates: firstStream is now stale

      expect(() => firstStream.emit('error', new Error('EIO'))).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[FileTransport] Stream error: EIO'));
      expect(transport.getStatus().writable).toBe(true); // live stream untouched
    });
  });

  describe('flush and getStatus', () => {
    test('flush resolves and closes the stream', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename });
      transport.send(makeEvent());

      await transport.flush(); // resolves once the stream has finished
      expect(transport.getStatus().writable).toBe(false);
    });

    test('flush resolves even when stream is already closed', async () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename });

      await transport.flush();
      await expect(transport.flush()).resolves.toBeUndefined();
    });

    test('getStatus reports configuration and live size', () => {
      const filename = path.join(tmpDir, 'app.log');
      const transport = create({ filename, format: 'pretty', maxSize: 1024, maxFiles: 5 });

      transport.send(makeEvent());

      const status = transport.getStatus();
      expect(status.name).toBe('file');
      expect(status.filename).toBe(filename);
      expect(status.format).toBe('pretty');
      expect(status.maxSize).toBe(1024);
      expect(status.maxFiles).toBe(5);
      expect(status.currentSize).toBeGreaterThan(0);
      expect(status.writable).toBe(true);
    });
  });
});
