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

  // Rotation bounds are a decision, not a default someone inherited.
  test('states its rotation bounds explicitly, capping disk at 200 MB', () => {
    const sink = durable(resolveGeneralFileSinks({ isDocker: true, mediaDir: MEDIA_DIR, repoRoot: REPO_ROOT }));
    expect(sink.maxSize).toBe(BACKEND_LOG_MAX_SIZE);
    expect(sink.maxFiles).toBe(BACKEND_LOG_MAX_FILES);
    expect(sink.maxSize * sink.maxFiles).toBe(200 * 1024 * 1024);
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
