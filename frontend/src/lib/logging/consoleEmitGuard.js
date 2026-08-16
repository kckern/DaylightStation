// frontend/src/lib/logging/consoleEmitGuard.js
// Breaks the logger↔interceptor feedback loop.
//
// The logger's dev output writes every event to the console as
// `[Logger] <event> {…}` (Logger.js devOutput). consoleInterceptor replaces the
// console methods and forwards whatever it sees BACK into the logger. Without a
// guard the logger's own console line is captured and re-shipped as a second
// `console.warn` / `console.error` event carrying the first event's formatted
// text — so every warn and error reached the backend twice, doubling volume on
// exactly the events worth keeping. Observed 2026-08-16: each
// `audio-shader.dimensions` warning appeared as both the real event and a
// `console.warn` echo of it.
//
// A re-entrancy flag rather than a prefix sniff, so it holds for any console
// output the logger makes, whatever the format string becomes. Its own tiny
// module so Logger.js and consoleInterceptor.js can both import it without a
// cycle (consoleInterceptor → singleton → Logger).

let emitting = false;

/** True while the logger is writing its own output to the console. */
export const isEmittingToConsole = () => emitting;

/** Run `fn` with console output marked as logger-originated. */
export function withConsoleEmit(fn) {
  const previous = emitting;
  emitting = true;
  try {
    return fn();
  } finally {
    emitting = previous;
  }
}

export default withConsoleEmit;
