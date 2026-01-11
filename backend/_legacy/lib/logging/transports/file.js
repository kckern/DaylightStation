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

  // Initialize write stream
  let stream = fs.createWriteStream(filename, { flags: 'a' });
  let currentSize = 0;

  // Get current file size if it exists
  try {
    if (fs.existsSync(filename)) {
      currentSize = fs.statSync(filename).size;
    }
  } catch (err) {
    process.stderr.write(`[FileTransport] Failed to stat file: ${err.message}\n`);
  }

  /**
   * Rotate log files when max size is reached
   */
  const rotateIfNeeded = () => {
    if (currentSize < maxSize) return;

    try {
      // Close current stream
      stream.end();

      // Rotate files: file.log.2 → file.log.3, file.log.1 → file.log.2, file.log → file.log.1
      for (let i = maxFiles - 1; i >= 1; i--) {
        const oldPath = i === 1 ? filename : `${filename}.${i}`;
        const newPath = `${filename}.${i + 1}`;

        if (fs.existsSync(oldPath)) {
          // Delete the oldest file if it exists
          if (i === maxFiles - 1 && fs.existsSync(newPath)) {
            fs.unlinkSync(newPath);
          }
          fs.renameSync(oldPath, newPath);
        }
      }

      // Rename current file to .1
      if (fs.existsSync(filename)) {
        fs.renameSync(filename, `${filename}.1`);
      }

      // Create new stream
      stream = fs.createWriteStream(filename, { flags: 'a' });
      currentSize = 0;

      process.stderr.write(`[FileTransport] Rotated log file: ${filename}\n`);
    } catch (err) {
      process.stderr.write(`[FileTransport] Rotation failed: ${err.message}\n`);
      // Try to create a new stream anyway
      try {
        stream = fs.createWriteStream(filename, { flags: 'a' });
        currentSize = 0;
      } catch (recreateErr) {
        process.stderr.write(`[FileTransport] Failed to recreate stream: ${recreateErr.message}\n`);
      }
    }
  };

  /**
   * Format event as JSON string
   * @param {Object} event
   * @returns {string}
   */
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

  /**
   * Format event as pretty-printed string
   * @param {Object} event
   * @param {boolean} useColors
   * @returns {string}
   */
  const formatPretty = (event, useColors) => {
    const levelColors = {
      debug: '\x1b[90m',  // Gray
      info: '\x1b[36m',   // Cyan
      warn: '\x1b[33m',   // Yellow
      error: '\x1b[31m'   // Red
    };
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';

    const levelStr = (event.level || 'info').toUpperCase().padEnd(5);
    const color = useColors ? (levelColors[event.level] || '') : '';
    const resetCode = useColors ? reset : '';
    const dimCode = useColors ? dim : '';

    // Format: [TIMESTAMP] [LEVEL] event.name { data } (context)
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

    /**
     * Send a log event to the file
     * @param {Object} event - Normalized log event
     */
    send(event) {
      const output = format === 'json'
        ? formatJson(event)
        : formatPretty(event, colorize);

      const line = output + '\n';
      const byteLength = Buffer.byteLength(line);

      try {
        stream.write(line);
        currentSize += byteLength;
        rotateIfNeeded();
      } catch (err) {
        process.stderr.write(`[FileTransport] Write failed: ${err.message}\n`);
      }
    },

    /**
     * Flush and close the file stream
     * @returns {Promise<void>}
     */
    async flush() {
      return new Promise((resolve) => {
        if (stream && stream.writable) {
          stream.end(resolve);
        } else {
          resolve();
        }
      });
    },

    /**
     * Get transport status
     * @returns {Object}
     */
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
