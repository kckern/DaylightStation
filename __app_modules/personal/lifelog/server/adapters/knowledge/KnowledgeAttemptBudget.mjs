import path from 'node:path';
import crypto from 'node:crypto';
import moment from 'moment-timezone';
import * as FileIO from '#system/utils/FileIO.mjs';
export function outsideKnowledgeDirectory(value, dataDir) {
  const root = FileIO.resolveRealPath(dataDir),
    dir = FileIO.resolveRealPath(value);
  if (!root || !dir || !FileIO.getFileStats(dir).isDirectory()) throw new Error('Usage directory must already exist outside the data tree');
  const relative = path.relative(root, dir);
  if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Usage directory must be outside the data tree');
  return dir;
}
export function reserveKnowledgeAttempt({
  dir,
  username,
  timezone,
  now,
  maxAttempts = 4
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) throw new TypeError('Invalid knowledge attempt cap');
  const user = crypto.createHash('sha256').update(username).digest('hex').slice(0, 24);
  const date = moment.tz(now, timezone).format('YYYY-MM-DD');
  for (let slot = 1; slot <= maxAttempts; slot++) {
    try {
      FileIO.writeFileExclusive(path.join(dir, `knowledge-budget-${user}-${date}-${slot}.json`), JSON.stringify({
        schema: 'knowledge-preview-budget/v1',
        at: now,
        date,
        slot
      }) + '\n');
      FileIO.appendTextFile(path.join(dir, `knowledge-budget-${user}-${date}-${slot}.json`), '', {
        durable: true
      });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Knowledge preview daily budget exhausted');
}
