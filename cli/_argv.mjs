/**
 * Tiny dependency-free argv parser for dscli.
 *
 * Returns: { subcommand, positional, flags, help }
 *   - subcommand: first non-flag token, or null if none
 *   - positional: remaining non-flag tokens (action + args)
 *   - flags: { [key]: string | true } — `--key value` or `--key` (bool)
 *   - help: true if argv was empty or contained --help / -h at any position
 *
 * Conventions:
 *   - `--` ends flag parsing; everything after is positional
 *   - tokens that look like negative numbers (-50, -50.00) are positional
 *   - subcommand-level --help (e.g. `ha --help`) sets help=true with subcommand set
 */

export function parseArgv(argv) {
  const flags = {};
  const positional = [];
  let subcommand = null;
  let help = false;
  let stopFlagParsing = false;

  if (!argv || argv.length === 0) {
    return { subcommand: null, positional: [], flags: {}, help: true };
  }

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (!stopFlagParsing && tok === '--') {
      stopFlagParsing = true;
      continue;
    }

    if (!stopFlagParsing && (tok === '--help' || tok === '-h')) {
      help = true;
      continue;
    }

    // Treat numeric tokens (e.g. "-50", "732539", "-50.00") as positional, not flags
    const isNumericLooking = /^-?\d+(\.\d+)?$/.test(tok);

    if (!stopFlagParsing && tok.startsWith('--') && !isNumericLooking) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }

    if (subcommand === null) {
      subcommand = tok;
    } else {
      positional.push(tok);
    }
  }

  return { subcommand, positional, flags, help };
}
