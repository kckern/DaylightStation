/**
 * Single argv parser for every `fitness.cli.mjs` subcommand.
 *
 * Before consolidation the fitness/strava scripts used three incompatible
 * styles: `strava.cli.mjs`'s `getArg`/`hasFlag`, raw `process.argv.includes()`
 * in the backfill scripts, and `fitness-split-session.mjs`'s `arg(name, def)`.
 * This module is the one rule they now share.
 *
 * Supported forms (all equivalent):
 *   --days=14        --days 14        (value flag)
 *   --write          (boolean flag)
 *   --no-commute     (explicit false for `commute`)
 *   -f               (short boolean flag)
 *   --              (end of flags; everything after is positional)
 *   bare tokens      (positional)
 *
 * @module cli/lib/fitness/argv
 */

/**
 * Parse an argv tail into positionals and a flag map.
 *
 * A flag's value is `true` when it is followed by another flag or by nothing,
 * so `--write` and `--write true` both read as boolean-on. `--no-x` sets `x`
 * to `false`. Repeated flags keep the last value.
 *
 * **Declare `booleanFlags`.** Without it a parser cannot know that `--write`
 * takes no value, so `--write 90` reads as `write="90"` and the `90` never
 * reaches `positional` — which silently reverted day counts to their default
 * and, worse, let `--write 1` mean "write, full history" instead of "write,
 * one day". Every command that mixes a boolean flag with a bare positional
 * must list its boolean flags here.
 *
 * @param {string[]} argv - argv tail (already sliced past the command name)
 * @param {Object} [opts]
 * @param {string[]} [opts.valueFlags] - flags that ALWAYS consume the next
 *   token as their value, even when it looks like a flag (e.g. a `--name`
 *   whose value legitimately starts with `--`).
 * @param {string[]} [opts.booleanFlags] - flags that NEVER consume the next
 *   token, so it stays a positional.
 * @returns {{positional: string[], flags: Object<string, string|boolean>, raw: string[]}}
 */
export function parseArgs(argv, { valueFlags = [], booleanFlags = [] } = {}) {
  const positional = [];
  const flags = {};
  const alwaysValue = new Set(valueFlags.map(stripDashes));
  const neverValue = new Set(booleanFlags.map(stripDashes));

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    // `--` ends flag parsing; the rest is positional verbatim.
    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    // Short boolean flag, e.g. `-f`. Negative numbers stay positional.
    if (/^-[a-zA-Z]$/.test(token)) {
      flags[token.slice(1)] = true;
      continue;
    }

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const body = token.slice(2);

    // --key=value
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    // --no-key
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      // Keep the literal form too, so callers that check `--no-commute`
      // directly (rather than `commute === false`) still work.
      flags[body] = true;
      continue;
    }

    // --key value  |  --key
    const next = argv[i + 1];
    const takesValue = next != null
      && !neverValue.has(body)
      && (alwaysValue.has(body) || !next.startsWith('--'));
    if (takesValue) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { positional, flags, raw: argv };
}

function stripDashes(name) {
  return String(name).replace(/^--/, '');
}

/**
 * Read a flag as a string, returning `undefined` when absent and `undefined`
 * when the flag was passed bare (no value) — a bare `--name` is not a name.
 *
 * @param {Object} flags
 * @param {string} name - flag name, with or without leading dashes
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
export function str(flags, name, fallback = undefined) {
  const v = flags[stripDashes(name)];
  if (v === undefined || v === true || v === false) return fallback;
  return String(v);
}

/**
 * Read a flag as a number. Returns `fallback` when absent or unparseable.
 *
 * @param {Object} flags
 * @param {string} name
 * @param {number} [fallback]
 * @returns {number|undefined}
 */
export function num(flags, name, fallback = undefined) {
  const v = str(flags, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read a flag as a boolean. Present-and-not-`--no-x` is true.
 *
 * @param {Object} flags
 * @param {string} name
 * @returns {boolean}
 */
export function bool(flags, name) {
  const v = flags[stripDashes(name)];
  if (v === undefined) return false;
  if (v === false) return false;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

/**
 * True when the flag was supplied at all (in any form), which is how the
 * Strava `update` command distinguishes "clear this field" from "leave alone".
 *
 * @param {Object} flags
 * @param {string} name
 * @returns {boolean}
 */
export function present(flags, name) {
  return Object.prototype.hasOwnProperty.call(flags, stripDashes(name));
}
