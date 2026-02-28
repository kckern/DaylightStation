import { describe, test, expect } from '@jest/globals';

/**
 * Mirrors the direct-play bypass condition from SinglePlayer.jsx (line 221).
 * The real code: if (directMediaUrl && directFormat && !getRenderer(directFormat) && !isRecoveryRemount)
 */
function shouldBypassPlayApi({ directMediaUrl, directFormat, hasRenderer, remountDiagnostics }) {
  const isRecoveryRemount = !!remountDiagnostics;
  return !!(directMediaUrl && directFormat && !hasRenderer && !isRecoveryRemount);
}

describe('SinglePlayer direct-play bypass during recovery', () => {

  test('bypasses /play API on normal mount with pre-resolved URL', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://plex/transcode/start.mpd?session=abc',
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: null,
    });
    expect(result).toBe(true);
  });

  test('does NOT bypass /play API during recovery remount', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://plex/transcode/start.mpd?session=abc',
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: { reason: 'startup-deadline-exceeded', remountNonce: 1 },
    });
    expect(result).toBe(false);
  });

  test('does NOT bypass when format has a content renderer (e.g., readalong)', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: 'http://example.com/content',
      directFormat: 'readalong',
      hasRenderer: true,
      remountDiagnostics: null,
    });
    expect(result).toBe(false);
  });

  test('does NOT bypass when no mediaUrl is provided', () => {
    const result = shouldBypassPlayApi({
      directMediaUrl: null,
      directFormat: 'dash_video',
      hasRenderer: false,
      remountDiagnostics: null,
    });
    expect(result).toBe(false);
  });
});
