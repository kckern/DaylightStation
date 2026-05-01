/**
 * HealthArchiveScope (F-106)
 *
 * Hard whitelist enforcement for the longitudinal-access surface. Every
 * historical-tool read MUST pass through `assertReadable(absPath, userId)`
 * before any filesystem touch. This test suite is purely path-string based
 * (no fs access) - symlink defense is documented as a follow-up under
 * tests/live/.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  HealthArchiveScope,
  DEFAULT_WORKOUT_SOURCES,
} from '#domains/health/services/HealthArchiveScope.mjs';

const USER = 'test-user';
const OTHER = 'other-user';

// Anchor every absolute path against deterministic project roots so the test
// is host-independent. The scope service operates on path strings only; it
// does not look at process.cwd or call fs.realpath. Tests pass these roots
// into the constructor; the whitelist is anchored to them.
const PROJECT_ROOT = '/srv/daylight';
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const MEDIA_ROOT = path.join(PROJECT_ROOT, 'media');

const scope = new HealthArchiveScope({ dataRoot: DATA_ROOT, mediaRoot: MEDIA_ROOT });

function abs(rel) {
  return path.join(PROJECT_ROOT, rel);
}

describe('HealthArchiveScope', () => {
  describe('constructor', () => {
    it('requires absolute dataRoot', () => {
      expect(() => new HealthArchiveScope({ dataRoot: 'data', mediaRoot: MEDIA_ROOT })).toThrow();
      expect(() => new HealthArchiveScope({ dataRoot: '', mediaRoot: MEDIA_ROOT })).toThrow();
      expect(() => new HealthArchiveScope({ mediaRoot: MEDIA_ROOT })).toThrow();
      expect(() => new HealthArchiveScope({ dataRoot: null, mediaRoot: MEDIA_ROOT })).toThrow();
    });

    it('requires absolute mediaRoot', () => {
      expect(() => new HealthArchiveScope({ dataRoot: DATA_ROOT, mediaRoot: 'media' })).toThrow();
      expect(() => new HealthArchiveScope({ dataRoot: DATA_ROOT, mediaRoot: '' })).toThrow();
      expect(() => new HealthArchiveScope({ dataRoot: DATA_ROOT })).toThrow();
    });

    it('exposes the configured roots (normalized)', () => {
      const s = new HealthArchiveScope({
        dataRoot: '/foo/./bar/baz',
        mediaRoot: '/baz/qux/../qux',
      });
      // path.normalize collapses redundant segments. Trailing slashes are
      // preserved on POSIX, but `.` and `..` are resolved.
      expect(s.dataRoot).toBe('/foo/bar/baz');
      expect(s.mediaRoot).toBe('/baz/qux');
    });
  });

  describe('whitelisted paths', () => {
    it('allows whitelisted health-archive paths for the matching user', () => {
      const allowed = [
        `data/users/${USER}/lifelog/archives/weight.yaml`,
        `data/users/${USER}/lifelog/archives/strava/2024-08-12-run.json`,
        `data/users/${USER}/lifelog/archives/garmin/activities/abc.fit`,
        `data/users/${USER}/lifelog/archives/nutrition-history/primary/2024-08-12.yml`,
        `data/users/${USER}/lifelog/archives/scans/2024-bodyspec.yml`,
        `data/users/${USER}/lifelog/archives/notes/strength-history.md`,
        `data/users/${USER}/lifelog/archives/playbook/playbook.yml`,
        `data/users/${USER}/health.yml`,
      ];
      for (const rel of allowed) {
        expect(scope.isReadable(abs(rel), USER)).toBe(true);
      }
    });

    it('allows media/archives/strava/** for any user (shared)', () => {
      const sharedPath = abs('media/archives/strava/2018-01-01-old-run.json');
      expect(scope.isReadable(sharedPath, USER)).toBe(true);
      expect(scope.isReadable(sharedPath, OTHER)).toBe(true);
    });
  });

  describe('out-of-whitelist paths', () => {
    it('blocks paths outside whitelist (paths under /etc, /usr, /var, /Users/...)', () => {
      const blocked = [
        '/etc/passwd',
        '/usr/local/bin/secrets',
        '/var/log/system.log',
        '/Users/kckern/.ssh/id_rsa',
        abs('data/users/test-user/secrets.yml'),
        abs('data/users/test-user/lifelog/archives/playbook.yml.bak'), // not in whitelist root
        abs('config/database.yml'),
      ];
      for (const p of blocked) {
        expect(scope.isReadable(p, USER)).toBe(false);
      }
    });

    it("blocks attempts to read another user's archive", () => {
      const otherUserPaths = [
        abs(`data/users/${OTHER}/lifelog/archives/weight.yaml`),
        abs(`data/users/${OTHER}/lifelog/archives/strava/2024.json`),
        abs(`data/users/${OTHER}/lifelog/archives/playbook/playbook.yml`),
        abs(`data/users/${OTHER}/health.yml`),
      ];
      for (const p of otherUserPaths) {
        expect(scope.isReadable(p, USER)).toBe(false);
      }
    });

    it('blocks paths matching exclusion privacy patterns (email/chat/finance/journal/calendar/social/banking)', () => {
      // These paths are syntactically inside the user's archive root, but the
      // privacy filter ALWAYS rejects them - defense in depth, mirrors the
      // exclusion set HealthArchiveIngestion uses.
      const blocked = [
        abs(`data/users/${USER}/lifelog/archives/notes/email-thread.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/chat-log.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/finance-summary.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/journal-2024.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/search-history.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/calendar-export.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/social-feed.md`),
        abs(`data/users/${USER}/lifelog/archives/notes/banking.md`),
      ];
      for (const p of blocked) {
        expect(scope.isReadable(p, USER)).toBe(false);
      }
    });

    it('blocks .. traversal - relative paths with ../ are normalized first', () => {
      // Each of these tries to escape the whitelist via path traversal.
      // path.normalize collapses `..` segments before whitelist matching.
      const traversalAttempts = [
        // Tries to walk out of the user's archive into another's
        abs(`data/users/${USER}/lifelog/archives/../../${OTHER}/health.yml`),
        // Tries to escape into /etc
        abs(`data/users/${USER}/lifelog/archives/../../../../etc/passwd`),
        // Tries to escape into a sibling's notes
        abs(`data/users/${USER}/lifelog/archives/notes/../../../${OTHER}/lifelog/archives/notes/private.md`),
        // Plain relative path with traversal (rejected for not being absolute too)
        '../../etc/passwd',
        // Empty path
        '',
      ];
      for (const p of traversalAttempts) {
        expect(scope.isReadable(p, USER)).toBe(false);
      }
    });

    it('blocks paths with NUL bytes (refuses to follow symlinks; path-string defenses only)', () => {
      // The scope service operates on path strings only - it does NOT call
      // fs.lstat or fs.realpath. Symlink-based escape is a defense-in-depth
      // concern documented for a future tests/live/ integration test.
      //
      // What we CAN verify here: the service never accepts a path that
      // contains a NUL byte (a common precursor to symlink attacks), is
      // non-absolute, or has trailing junk after the whitelisted tail.
      expect(scope.isReadable('relative/path/weight.yaml', USER)).toBe(false);
      // NUL byte inside an otherwise-whitelisted path - rejected up front,
      // BEFORE path.normalize runs.
      const withNul = abs(`data/users/${USER}/lifelog/archives/weight.yaml\x00.bak`);
      expect(scope.isReadable(withNul, USER)).toBe(false);
      // TODO(F-106-followup): live integration test under tests/live/ that
      // creates a symlink inside the user archive pointing to /etc/passwd
      // and asserts the longitudinal tools (which use realpath internally)
      // refuse to follow it. Track in roadmap.
    });

    it('blocks paths NOT anchored under the configured dataRoot (I-4: leading-prefix anchor)', () => {
      // Before I-4, a path like /random/junk/data/users/alice/... would
      // match because the whitelist tail regex was anchored on `(?:^|/)`.
      // Post-I-4, isReadable requires absPath to start with the configured
      // dataRoot or mediaRoot, so paths under arbitrary prefixes fail.
      const offRoot = [
        `/random/junk/data/users/${USER}/lifelog/archives/weight.yaml`,
        `/tmp/data/users/${USER}/lifelog/archives/strava/2024.json`,
        `/var/data/users/${USER}/health.yml`,
        `/random/media/archives/strava/2018.json`,
      ];
      for (const p of offRoot) {
        expect(scope.isReadable(p, USER)).toBe(false);
      }
    });

    it('does not match a sibling root that shares a string prefix with dataRoot', () => {
      // Guard against `/srv/daylight-evil/data/users/...` slipping through
      // a naive `startsWith` check on `/srv/daylight/data`.
      const evilScope = new HealthArchiveScope({
        dataRoot: '/srv/daylight/data',
        mediaRoot: '/srv/daylight/media',
      });
      expect(evilScope.isReadable(
        `/srv/daylight-evil/data/users/${USER}/lifelog/archives/weight.yaml`,
        USER,
      )).toBe(false);
    });
  });

  describe('instance API', () => {
    it('assertReadable(absPath, userId) throws on violation, returns void on success', () => {
      // Throws on violation
      expect(() => scope.assertReadable('/etc/passwd', USER))
        .toThrow(/HealthArchiveScope/);

      // Returns void (undefined) on success
      const ok = scope.assertReadable(
        abs(`data/users/${USER}/lifelog/archives/weight.yaml`),
        USER,
      );
      expect(ok).toBeUndefined();
    });

    it('also exposes isReadable(absPath, userId) -> boolean for non-throwing checks', () => {
      expect(typeof scope.isReadable).toBe('function');
      expect(scope.isReadable(
        abs(`data/users/${USER}/lifelog/archives/weight.yaml`),
        USER,
      )).toBe(true);
      expect(scope.isReadable('/etc/passwd', USER)).toBe(false);
    });

    it('rejects non-absolute and empty paths via isReadable', () => {
      expect(scope.isReadable('', USER)).toBe(false);
      expect(scope.isReadable('relative/path.yml', USER)).toBe(false);
      expect(scope.isReadable(null, USER)).toBe(false);
      expect(scope.isReadable(undefined, USER)).toBe(false);
    });

    it('rejects calls with invalid userId by throwing from assertReadable / returning false from isReadable', () => {
      const goodPath = abs(`data/users/${USER}/lifelog/archives/weight.yaml`);
      // assertReadable: invalid userId is a programmer error, throw.
      expect(() => scope.assertReadable(goodPath, '../etc')).toThrow();
      expect(() => scope.assertReadable(goodPath, '')).toThrow();
      // isReadable: invalid userId returns false (does not throw - used for
      // best-effort gating before logging).
      expect(scope.isReadable(goodPath, '../etc')).toBe(false);
      expect(scope.isReadable(goodPath, '')).toBe(false);
    });
  });

  describe('static assertValidUserId', () => {
    it('exposes assertValidUserId(userId) - throws on invalid format', () => {
      expect(typeof HealthArchiveScope.assertValidUserId).toBe('function');
      // Valid
      expect(() => HealthArchiveScope.assertValidUserId('test-user')).not.toThrow();
      expect(() => HealthArchiveScope.assertValidUserId('alice_42')).not.toThrow();
      // Invalid: traversal, slash, dot, empty, non-string, special chars
      expect(() => HealthArchiveScope.assertValidUserId('../etc')).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId('a/b')).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId('with space')).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId('')).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId(null)).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId(undefined)).toThrow();
      expect(() => HealthArchiveScope.assertValidUserId(123)).toThrow();
    });
  });

  describe('workout-source vocabulary (F4-A)', () => {
    it('exposes DEFAULT_WORKOUT_SOURCES = ["strava", "garmin"]', () => {
      expect([...DEFAULT_WORKOUT_SOURCES]).toEqual(['strava', 'garmin']);
    });

    it('default workout sources still work without an explicit list', () => {
      const s = new HealthArchiveScope({ dataRoot: DATA_ROOT, mediaRoot: MEDIA_ROOT });
      expect(s.workoutSources).toEqual(['strava', 'garmin']);
      expect(s.isReadable(
        abs(`data/users/${USER}/lifelog/archives/strava/2024-08-12-run.json`),
        USER,
      )).toBe(true);
      expect(s.isReadable(
        abs(`data/users/${USER}/lifelog/archives/garmin/activities/abc.fit`),
        USER,
      )).toBe(true);
    });

    it('accepts a custom workoutSources list and whitelists it', () => {
      const s = new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['apple_health'],
      });
      expect(s.workoutSources).toEqual(['apple_health']);
      // apple_health is now whitelisted
      expect(s.isReadable(
        abs(`data/users/${USER}/lifelog/archives/apple_health/2024-08-12.xml`),
        USER,
      )).toBe(true);
      // strava is NOT whitelisted any more — only the user's declared sources count
      expect(s.isReadable(
        abs(`data/users/${USER}/lifelog/archives/strava/2024-08-12-run.json`),
        USER,
      )).toBe(false);
    });

    it('shared (cross-user) media archive respects the workoutSources list too', () => {
      const s = new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['strava', 'garmin', 'apple_health'],
      });
      expect(s.isReadable(abs('media/archives/strava/old.json'), USER)).toBe(true);
      expect(s.isReadable(abs('media/archives/garmin/old.fit'), USER)).toBe(true);
      expect(s.isReadable(abs('media/archives/apple_health/old.xml'), USER)).toBe(true);
      // Sources NOT in the list aren't allowed even under the shared root.
      expect(s.isReadable(abs('media/archives/whoop/old.json'), USER)).toBe(false);
    });

    it('rejects workoutSources that contain regex metacharacters or path separators', () => {
      expect(() => new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['strava/../evil'],
      })).toThrow();
      expect(() => new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['..'],
      })).toThrow();
      expect(() => new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['ev|il'],
      })).toThrow();
    });

    it('rejects non-array workoutSources', () => {
      expect(() => new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: 'strava',
      })).toThrow();
    });

    it('de-duplicates the list', () => {
      const s = new HealthArchiveScope({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        workoutSources: ['strava', 'strava', 'garmin'],
      });
      expect([...s.workoutSources]).toEqual(['strava', 'garmin']);
    });
  });

  describe('static validatePathSegment (I-1)', () => {
    it('accepts simple filenames and dotted variants', () => {
      expect(HealthArchiveScope.validatePathSegment('notes.md')).toBe('notes.md');
      expect(HealthArchiveScope.validatePathSegment('2024-01-15-dexa.yml')).toBe('2024-01-15-dexa.yml');
      expect(HealthArchiveScope.validatePathSegment('readme.txt')).toBe('readme.txt');
    });

    it('accepts nested relative paths with allowed chars', () => {
      expect(HealthArchiveScope.validatePathSegment('sub/dir/file.txt')).toBe('sub/dir/file.txt');
      expect(HealthArchiveScope.validatePathSegment('a-b_c.d/e_f-g.txt')).toBe('a-b_c.d/e_f-g.txt');
    });

    it('rejects empty string', () => {
      expect(() => HealthArchiveScope.validatePathSegment('')).toThrow();
    });

    it('rejects non-string input', () => {
      expect(() => HealthArchiveScope.validatePathSegment(null)).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment(undefined)).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment(42)).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment({})).toThrow();
    });

    it('rejects paths starting with ..', () => {
      expect(() => HealthArchiveScope.validatePathSegment('../etc/passwd')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('..')).toThrow();
    });

    it('rejects paths containing /../ that survive normalization', () => {
      // path.normalize collapses interior `..` only when there is a
      // preceding segment to consume. `a/../b` -> `b` (safe). But
      // `a/b/../../c/../d` -> `d`. The threat we DO catch is leading-..
      // that survives normalization.
      expect(() => HealthArchiveScope.validatePathSegment('../../etc/passwd')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('a/../../etc/passwd')).toThrow();
    });

    it('rejects paths starting with /', () => {
      expect(() => HealthArchiveScope.validatePathSegment('/etc/passwd')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('/abs/path.txt')).toThrow();
    });

    it('rejects paths with a NUL byte (NUL check runs BEFORE normalize)', () => {
      // I-2: ordering invariant. NUL must be rejected up front so we never
      // depend on path.normalize preserving (or not) NULs across Node versions.
      expect(() => HealthArchiveScope.validatePathSegment('notes\x00.md')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('a/b\x00/c.txt')).toThrow();
    });

    it('rejects paths with disallowed characters', () => {
      expect(() => HealthArchiveScope.validatePathSegment('with space.txt')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('what?.txt')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('star*.txt')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('back\\slash.txt')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('quote".txt')).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment("apos'.txt")).toThrow();
      expect(() => HealthArchiveScope.validatePathSegment('semi;colon.txt')).toThrow();
    });
  });
});
