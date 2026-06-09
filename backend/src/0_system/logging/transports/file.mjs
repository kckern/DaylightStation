/**
 * File Transport
 *
 * Writes log events to a file with automatic rotation based on size.
 * Supports JSON and pretty-printed formats.
 */

import fs from 'fs';
import path from 'path';

/**
 * Create a file transport
 * @param {Object} options
 * @param {string} options.filename - Path to log file (required)
 * @param {string} options.format - 'json' | 'pretty' (default: 'json')
 * @param {number} options.maxSize - Max file size in bytes before rotation (default: 50MB)
 * @param {number} options.maxFiles - Max number of rotated files to keep (default: 3)
 * @param {boolean} options.colorize - Enable ANSI colors in pretty format (default: false)
 * @returns {Object} Transport object
 */
export function createFileTransport(options = {}) {
  const {
    filename,
    format = 'json',
    maxSize = 50 * 1024 * 1024, // 50 MB default
    maxFiles = 3,
    colorize = false
  } = options;

  if (!filename) {
    throw new Error('File transport requires a filename option');
  }

  // Ensure directory exists
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new Error(`Failed to create log directory: ${dir} - ${err.message}`);
    }
  }

  let stream = null;
  let currentSize = 0;

  /**
   * Open a write stream on the log file.
   *
   * The fd is opened eagerly (rather than letting createWriteStream open it
   * lazily) for two reasons:
   * - The file is guaranteed to exist on disk before any rotation check, so
   *   a first write that exceeds maxSize still finds a file to rename.
   * - Buffered writes follow the inode (the fd), not the path, so data still
   *   queued on a rotated-out stream flushes into the renamed generation
   *   instead of leaking into the fresh live file.
   *
   * An 'error' listener is attached so async write errors (ENOSPC, EACCES on
   * the fd, ...) never surface as an unhandled 'error' event and crash the
   * process. On stream error we warn on stderr (never via the logger itself —
   * recursion) and null the stream; a later send() re-opens it (fail soft).
   */
  const openStream = () => {
    const fd = fs.openSync(filename, 'a');
    const s = fs.createWriteStream(filename, { flags: 'a', fd });
    s.on('error', (err) => {
      process.stderr.write(`[FileTransport] Stream error: ${err.message}\n`);
      if (stream === s) {
        stream = null; // dropped until a later send() re-opens
      }
    });
    return s;
  };

  // Initialize write stream
  stream = openStream();

  // Get current file size if it exists
  try {
    if (fs.existsSync(filename)) {
      currentSize = fs.statSync(filename).size;
    }
  } catch (err) {
    process.stderr.write(`[FileTransport] Failed to stat file: ${err.message}\n`);
  }

  /**
   * Rotate log files when max size is reached.
   *
   * Conventional logrotate scheme: the live file becomes `.1` (newest), `.1`
   * becomes `.2`, ... up to `.{maxFiles - 1}` (oldest), which falls off.
   * Exactly maxFiles generations are retained, counting the live file.
   * With maxFiles: 1 only the live file is retained — the full generation is
   * discarded on rotation.
   *
   * The rotation decision is based on the tracked currentSize, not on-disk
   * size; openStream() guarantees the file exists by the time we rename it,
   * even when the very first write triggers rotation.
   */
  const rotateIfNeeded = () => {
    if (currentSize < maxSize) return;

    try {
      stream.end();

      // Drop the oldest generation if it is at the cap
      const oldest = `${filename}.${maxFiles - 1}`;
      if (maxFiles > 1 && fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
      }

      // Shift the remaining generations up: .{i} -> .{i + 1}
      for (let i = maxFiles - 2; i >= 1; i--) {
        const oldPath = `${filename}.${i}`;
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, `${filename}.${i + 1}`);
        }
      }

      // Live file becomes .1 (or is discarded when maxFiles is 1)
      if (fs.existsSync(filename)) {
        if (maxFiles > 1) {
          fs.renameSync(filename, `${filename}.1`);
        } else {
          fs.unlinkSync(filename);
        }
      }

      stream = openStream();
      currentSize = 0;

      process.stderr.write(`[FileTransport] Rotated log file: ${filename}\n`);
    } catch (err) {
      process.stderr.write(`[FileTransport] Rotation failed: ${err.message}\n`);
      try {
        stream = openStream();
        currentSize = 0;
      } catch (recreateErr) {
        process.stderr.write(`[FileTransport] Failed to recreate stream: ${recreateErr.message}\n`);
      }
    }
  };

  const formatJson = (event) => {
    try {
      return JSON.stringify(event);
    } catch (err) {
      return JSON.stringify({
        ts: event.ts,
        level: 'error',
        event: 'log-format-error',
        message: 'Failed to stringify log event',
        data: { error: err.message }
      });
    }
  };

  const formatPretty = (event, useColors) => {
    const levelColors = {
      debug: '\x1b[90m',
      info: '\x1b[36m',
      warn: '\x1b[33m',
      error: '\x1b[31m'
    };
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';

    const levelStr = (event.level || 'info').toUpperCase().padEnd(5);
    const color = useColors ? (levelColors[event.level] || '') : '';
    const resetCode = useColors ? reset : '';
    const dimCode = useColors ? dim : '';

    let output = `${dimCode}[${event.ts}]${resetCode} ${color}[${levelStr}]${resetCode} ${event.event}`;

    if (event.data && Object.keys(event.data).length > 0) {
      try {
        output += ` ${dimCode}${JSON.stringify(event.data)}${resetCode}`;
      } catch (err) {
        output += ` ${dimCode}[data serialization failed]${resetCode}`;
      }
    }

    if (event.context?.app) {
      output += ` ${dimCode}(${event.context.app})${resetCode}`;
    }

    if (event.context?.source) {
      output += ` ${dimCode}<${event.context.source}>${resetCode}`;
    }

    return output;
  };

  return {
    name: 'file',

    send(event) {
      const output = format === 'json'
        ? formatJson(event)
        : formatPretty(event, colorize);

      const line = output + '\n';
      const byteLength = Buffer.byteLength(line);

      try {
        if (!stream) {
          // Previous stream died on an async 'error'; attempt a re-open.
          // If this throws we land in the catch below and drop the line.
          stream = openStream();
        }
        stream.write(line);
        currentSize += byteLength;
        rotateIfNeeded();
      } catch (err) {
        process.stderr.write(`[FileTransport] Write failed: ${err.message}\n`);
      }
    },

    async flush() {
      return new Promise((resolve) => {
        if (stream && stream.writable) {
          stream.end(resolve);
        } else {
          resolve();
        }
      });
    },

    getStatus() {
      return {
        name: 'file',
        filename,
        format,
        currentSize,
        maxSize,
        maxFiles,
        writable: stream?.writable || false
      };
    }
  };
}

export default createFileTransport;
