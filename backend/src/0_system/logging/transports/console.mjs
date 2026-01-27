/**
 * Console Transport
 *
 * Outputs log events to stdout/stderr with optional formatting.
 */

/**
 * Create a console transport
 * @param {Object} options
 * @param {boolean} options.colorize - Enable ANSI colors (default: true)
 * @param {string} options.format - 'json' | 'pretty' (default: 'json')
 * @returns {Object} Transport object
 */
export function createConsoleTransport(options = {}) {
  const { colorize = true, format = 'json' } = options;

  return {
    name: 'console',

    send(event) {
      const output = format === 'json'
        ? formatJson(event)
        : formatPretty(event, colorize);

      const stream = event.level === 'error' || event.level === 'warn'
        ? process.stderr
        : process.stdout;

      stream.write(output + '\n');
    }
  };
}

/**
 * Format event as JSON string
 */
function formatJson(event) {
  return JSON.stringify(event);
}

/**
 * Format event as pretty-printed string with optional colors
 */
function formatPretty(event, colorize) {
  const levelColors = {
    debug: '\x1b[90m',  // Gray
    info: '\x1b[36m',   // Cyan
    warn: '\x1b[33m',   // Yellow
    error: '\x1b[31m'   // Red
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';

  const levelStr = event.level.toUpperCase().padEnd(5);
  const color = colorize ? (levelColors[event.level] || '') : '';
  const resetCode = colorize ? reset : '';
  const dimCode = colorize ? dim : '';

  let output = `${color}[${levelStr}]${resetCode} ${event.event}`;

  if (event.data && Object.keys(event.data).length > 0) {
    output += ` ${dimCode}${JSON.stringify(event.data)}${resetCode}`;
  }

  if (event.context?.app) {
    output += ` ${dimCode}(${event.context.app})${resetCode}`;
  }

  return output;
}

export default createConsoleTransport;
