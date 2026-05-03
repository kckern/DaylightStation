/**
 * CLI write-audit log. Append-only NDJSON per UTC date.
 *
 * Each successful write command calls `audit.log({...})` after the underlying
 * service confirms success. Logging never fails the command:
 *   - Primary path: the configured baseDir (typically data/household/cli-transcripts/)
 *   - Fallback: /tmp/dscli-cli-transcripts/ when the primary path is read-only
 *     (typical on dev hosts where the data volume is owned by Docker)
 *   - Last resort: stderr warning with both error messages
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';

const SENSITIVE_KEYS = new Set(['token', 'password', 'apiKey', 'api_key', 'secret', 'authorization']);
const FALLBACK_DIR = '/tmp/dscli-cli-transcripts';

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : redact(v);
  }
  return out;
}

export function createWriteAuditor({ baseDir, dateFn = () => new Date().toISOString().slice(0, 10) } = {}) {
  return {
    async log({ command, action, args, result }) {
      const entry = {
        timestamp: new Date().toISOString(),
        command,
        action,
        args: redact(args),
        result: redact(result),
        pid: process.pid,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
      };
      const line = JSON.stringify(entry) + '\n';
      const tryWrite = async (dir) => {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.appendFile(path.join(dir, `${dateFn()}.ndjson`), line, 'utf8');
      };
      try {
        await tryWrite(baseDir);
      } catch (err1) {
        try {
          await tryWrite(FALLBACK_DIR);
        } catch (err2) {
          process.stderr.write(
            `dscli: audit log write failed (primary ${baseDir}: ${err1.message}; fallback ${FALLBACK_DIR}: ${err2.message})\n`,
          );
        }
      }
    },
  };
}
