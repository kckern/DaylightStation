import { describe, test, expect } from 'vitest';
import path from 'path';
import {
  resolveGeneralFileSinks,
  BACKEND_LOG_MAX_SIZE,
  BACKEND_LOG_MAX_FILES,
} from '#backend/src/0_system/logging/generalSinks.mjs';

const MEDIA_DIR = '/srv/daylight/media';
const REPO_ROOT = '/srv/daylight';

const durable = (sinks) => sinks.find((s) => s.filename.endsWith(path.join('logs', 'backend.log')));

describe('general file sinks', () => {
  // The finding this exists for: in Docker the file transport was skipped and
  // Loggly has no token, so stdout was the dispatcher's only general sink — and
  // stdout is what Docker truncated 90 minutes after the 2026-08-16 incident.
  test('registers the durable backend log in Docker', () => {
    const sinks = resolveGeneralFileSinks({ isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT });
    expect(durable(sinks)).toBeTruthy();
    expect(durable(sinks).filename).toBe(path.join(MEDIA_DIR, 'logs', 'backend.log'));
  });

  test('registers the durable backend log outside Docker too', () => {
    const sinks = resolveGeneralFileSinks({ isDocker: false, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT });
    expect(durable(sinks)).toBeTruthy();
  });

  // Rotation bounds are a decision, not a default someone inherited. 30 MB is
  // deliberately modest: the default path sits inside a Dropbox-synced folder
  // on prod, where an append-and-rotate file costs version history that the
  // on-disk ceiling does not bound.
  test('states its rotation bounds explicitly, capping disk at 30 MB', () => {
    const sink = durable(resolveGeneralFileSinks({ isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT }));
    expect(sink.maxSize).toBe(BACKEND_LOG_MAX_SIZE);
    expect(sink.maxFiles).toBe(BACKEND_LOG_MAX_FILES);
    expect(sink.maxSize * sink.maxFiles).toBe(30 * 1024 * 1024);
  });

  // The bounds and the location are configurable so the log can be MOVED off
  // the synced volume rather than shrunk further — an infra decision that
  // should not need a code change.
  test('takes its bounds from system config when given', () => {
    const sink = durable(resolveGeneralFileSinks({
      isDocker: true,
      mediaDir: MEDIA_DIR,
      repoRoot: REPO_ROOT,
      config: { maxSizeMb: 50, maxFiles: 4 },
    }));
    expect(sink.maxSize).toBe(50 * 1024 * 1024);
    expect(sink.maxFiles).toBe(4);
  });

  test('takes its location from system config when given', () => {
    const sinks = resolveGeneralFileSinks({
      isDocker: true,
      mediaDir: MEDIA_DIR,
      repoRoot: REPO_ROOT,
      config: { path: '/var/log/daylight/backend.log' },
    });
    expect(sinks[0].filename).toBe('/var/log/daylight/backend.log');
    // …and it still carries the default bounds it was not asked to change.
    expect(sinks[0].maxSize).toBe(BACKEND_LOG_MAX_SIZE);
  });

  // A YAML typo must not produce a transport that rotates on every line or
  // never rotates at all.
  test('falls back to the defaults for unusable configured values', () => {
    for (const config of [
      { maxSizeMb: 0, maxFiles: 0 },
      { maxSizeMb: -5, maxFiles: -1 },
      { maxSizeMb: 'ten', maxFiles: 'three' },
      { maxSizeMb: null, maxFiles: undefined },
      { path: '   ' },
    ]) {
      const sink = durable(resolveGeneralFileSinks({
        isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT, config,
      }));
      expect(sink, `no durable sink for ${JSON.stringify(config)}`).toBeTruthy();
      expect(sink.maxSize).toBe(BACKEND_LOG_MAX_SIZE);
      expect(sink.maxFiles).toBe(BACKEND_LOG_MAX_FILES);
    }
  });

  // Numbers arriving as strings from YAML are still numbers to an operator.
  test('accepts numeric strings from YAML', () => {
    const sink = durable(resolveGeneralFileSinks({
      isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT, config: { maxSizeMb: '20', maxFiles: '2' },
    }));
    expect(sink.maxSize).toBe(20 * 1024 * 1024);
    expect(sink.maxFiles).toBe(2);
  });

  // dev.log is tailed by the Playwright harnesses at that exact repo-root path,
  // so the durable sink must be an addition to it, never a replacement.
  test('keeps dev.log alongside it outside Docker, and drops it inside', () => {
    const dev = resolveGeneralFileSinks({ isDocker: false, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT });
    expect(dev.map((s) => s.filename)).toContain(path.join(REPO_ROOT, 'dev.log'));

    const docker = resolveGeneralFileSinks({ isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT });
    expect(docker.map((s) => s.filename)).not.toContain(path.join(REPO_ROOT, 'dev.log'));
  });

  test('refuses to guess a media directory', () => {
    expect(() => resolveGeneralFileSinks({ isDocker: true, mediaDir: null, repoRoot: REPO_ROOT }))
      .toThrow(/mediaDir/);
  });
});
