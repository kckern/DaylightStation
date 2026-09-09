/**
 * The graceful failure. Two locks, both load-bearing:
 *
 *   1. A provider's words are never the user's words. `DaylightAPI` throws
 *      `HTTP <status>: <statusText> - <body>`, and when a PROXY produced the
 *      failure that body is a whole HTML error page.
 *   2. A gateway status is not "your recording is gone" — the capture is
 *      persisted before transcription is attempted.
 *
 * The literal string below is the one that actually reached the screen on
 * 2026-09-09, when the OpenAI balance ran out: upstream 429
 * (`credit_balance_exhausted`) -> gateway 502 -> the page, rendered verbatim
 * over somebody's workout.
 */
import { describe, it, expect } from 'vitest';
import { humanMessage, uploadFailureCopy } from './useVoiceMemoRecorder.js';

const THE_502 = 'HTTP 502: Bad Gateway - <!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n'
  + '<title>Connecting...</title>\n<style>body{font-family:sans-serif;background:#111;color:#eee}</style>\n'
  + '</head>\n<body><h1>Bad Gateway</h1></body>\n</html>';

describe('humanMessage — what a person is allowed to see', () => {
  it('refuses the gateway HTML page that shipped to the screen', () => {
    expect(humanMessage(THE_502, 'fallback')).toBe('fallback');
    expect(humanMessage(THE_502, 'fallback')).not.toMatch(/font-family|DOCTYPE|<style/);
  });

  it('refuses markup, a JSON body, and an HTTP envelope', () => {
    expect(humanMessage('<b>nope</b>', 'fallback')).toBe('fallback');
    expect(humanMessage('HTTP 500: Internal Server Error - {"error":"x"}', 'fallback')).toBe('fallback');
    expect(humanMessage('{"error":"boom"}', 'fallback')).toBe('fallback');
  });

  it('refuses anything too long to be a sentence', () => {
    expect(humanMessage('x'.repeat(400), 'fallback')).toBe('fallback');
  });

  it('lets a real sentence through untouched', () => {
    const sentence = 'Transcription is unavailable right now.';
    expect(humanMessage(sentence, 'fallback')).toBe(sentence);
  });

  it('falls back for a missing or empty message rather than showing nothing', () => {
    expect(humanMessage(null, 'fallback')).toBe('fallback');
    expect(humanMessage('   ', 'fallback')).toBe('fallback');
    expect(humanMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('uploadFailureCopy — saying only what is known', () => {
  it('reads the status off the thrown HTTP envelope', () => {
    const copy = uploadFailureCopy(new Error(THE_502));
    expect(copy.code).toBe('transcriber_unreachable');
    // NOT "your memo failed": the capture is persisted before transcription.
    expect(copy.message).toMatch(/kept/i);
    expect(copy.message.length).toBeLessThan(160);
  });

  it('reads a numeric status field when the client provides one', () => {
    expect(uploadFailureCopy(Object.assign(new Error('x'), { status: 504 })).code)
      .toBe('transcriber_unreachable');
    expect(uploadFailureCopy(Object.assign(new Error('x'), { status: 503 })).code)
      .toBe('transcriber_unreachable');
  });

  it('treats a non-gateway failure as a save that did not happen', () => {
    const copy = uploadFailureCopy(Object.assign(new Error('x'), { status: 400 }));
    expect(copy.code).toBe('upload_failed');
    expect(copy.message).toMatch(/try again/i);
  });

  it('never returns markup, whatever it was handed', () => {
    for (const err of [new Error(THE_502), new Error('<html>'), {}, null]) {
      expect(uploadFailureCopy(err).message).not.toMatch(/[<>{}]/);
    }
  });
});
