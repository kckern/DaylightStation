/**
 * Output contract for dscli.
 *
 * Success: single JSON value on stdout, newline-terminated, exit 0.
 * Error:   single JSON envelope on stderr, newline-terminated, non-zero exit.
 *
 * Exit codes match the spec at docs/superpowers/specs/2026-05-02-dscli-design.md.
 */

export const EXIT_OK      = 0;
export const EXIT_FAIL    = 1;
export const EXIT_USAGE   = 2;
export const EXIT_CONFIG  = 3;
export const EXIT_BACKEND = 4;

export function printJson(stream, value) {
  stream.write(JSON.stringify(value) + '\n');
}

export function printError(stream, errOrEnvelope) {
  let envelope;
  if (errOrEnvelope instanceof Error) {
    envelope = { error: errOrEnvelope.message };
  } else if (typeof errOrEnvelope === 'string') {
    envelope = { error: errOrEnvelope };
  } else if (errOrEnvelope && typeof errOrEnvelope === 'object') {
    envelope = errOrEnvelope;
  } else {
    envelope = { error: String(errOrEnvelope) };
  }
  stream.write(JSON.stringify(envelope) + '\n');
}
