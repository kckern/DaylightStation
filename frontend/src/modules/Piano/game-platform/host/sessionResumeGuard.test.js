/**
 * EVERY CHECKPOINTED AUTHORITY HOOK MUST GUARD ITS RESUME.
 *
 * These hooks resume a session id out of localStorage on every mount. A
 * finished session resumed that way hands the player back the game they lost
 * and refiles the result — the 2026-09-01 Connect Four loop, which shipped in
 * all three hooks at once because the third was copied from the first two.
 *
 * The list is asserted BY NAME, not by count: a walk that only counts loses
 * coverage silently when a file moves, and silent loss of coverage is the
 * failure mode this file exists to prevent. A fourth game fails this test
 * until it is added here AND carries the guard.
 *
 * The guard check looks for a CALL, `isResumableSession(`, not for the bare
 * symbol anywhere in the file. The import line and the explanatory comments in
 * each hook both mention the symbol, so a whole-file substring check stays
 * green even when the call site itself has been gutted — verified by breaking
 * the checkers hook and watching the loose check pass.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIANO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GOVERNED = [
  'PianoCheckers/useCheckersAuthority.js',
  'PianoChessGame/useChessAuthority.js',
  'PianoConnectFour/useConnectFourAuthority.js',
];

function findAuthorityHooks(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) findAuthorityHooks(full, found);
    else if (/^use.*Authority\.js$/.test(entry)) found.push(path.relative(PIANO, full));
  }
  return found;
}

describe('checkpointed session resume guard', () => {
  it('governs every authority hook in the piano tree, by name', () => {
    expect(findAuthorityHooks(PIANO).sort()).toEqual([...GOVERNED].sort());
  });

  it('every governed hook refuses to resume a terminal session', () => {
    const missing = GOVERNED.filter(
      (rel) => !/isResumableSession\s*\(/.test(readFileSync(path.join(PIANO, rel), 'utf8')),
    );
    expect(
      missing,
      'These hooks resume a stored session without ever calling isResumableSession(), '
      + 'so they cannot tell a game in progress from one that already ended — a finished '
      + 'session resumed on mount hands the player back the game they lost and refiles the '
      + 'result. Import isResumableSession from '
      + 'Gaming/platform/authority/createCheckpointedLocalAuthority.js and adopt the resumed '
      + 'session only when it passes. (Importing it is not enough; this checks for the call.)',
    ).toEqual([]);
  });
});
