/**
 * The preview link's codec. A teacher pastes one of these into the Portal to
 * look at a launch card without minting a panel code, so the two things that
 * matter are that a link round-trips exactly and that junk is REFUSED with a
 * reason rather than decoded into a half-payload nobody asked for.
 */
import { describe, expect, it } from 'vitest';
import {
  encodeLaunchPreviewLink,
  decodeLaunchPreviewLink,
} from '#domains/school/selfService/launchPreviewLink.mjs';

describe('launch preview link — round trip', () => {
  it('encodes a learner and subject into a url-safe segment and reads it back', () => {
    const link = encodeLaunchPreviewLink({ learnerId: 'learner4', subject: 'scripture' });
    expect(link).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLaunchPreviewLink(link)).toEqual({
      ok: true,
      payload: { learnerId: 'learner4', subject: 'scripture', continueToday: false },
    });
  });

  it('carries continueToday when asked, so the "one more?" card can be previewed too', () => {
    const link = encodeLaunchPreviewLink({ learnerId: 'learner4', subject: 'math', continueToday: true });
    expect(decodeLaunchPreviewLink(link).payload.continueToday).toBe(true);
  });

  it('refuses to encode a payload that names no learner or no subject', () => {
    expect(() => encodeLaunchPreviewLink({ learnerId: 'learner4' })).toThrow(/subject/i);
    expect(() => encodeLaunchPreviewLink({ subject: 'math' })).toThrow(/learner/i);
  });
});

describe('launch preview link — malformed input never decodes to a guess', () => {
  it('junk that is not base64 at all', () => {
    const result = decodeLaunchPreviewLink('!!!! not a link !!!!');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreadable');
    expect(result.sentence).toMatch(/preview link/i);
  });

  it('valid base64 that is not JSON', () => {
    const result = decodeLaunchPreviewLink(Buffer.from('hello there').toString('base64url'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreadable');
  });

  it('valid JSON that is not an object', () => {
    const result = decodeLaunchPreviewLink(Buffer.from('[1,2,3]').toString('base64url'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreadable');
  });

  it('a well-formed object missing the fields the card needs', () => {
    const result = decodeLaunchPreviewLink(Buffer.from('{"learnerId":"learner4"}').toString('base64url'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('incomplete');
    expect(result.sentence).toMatch(/learner and a subject/i);
  });

  it('an empty or absent segment', () => {
    expect(decodeLaunchPreviewLink('').ok).toBe(false);
    expect(decodeLaunchPreviewLink(null).ok).toBe(false);
    expect(decodeLaunchPreviewLink(undefined).reason).toBe('unreadable');
  });

  it('an absurdly long segment is refused before it is parsed', () => {
    const result = decodeLaunchPreviewLink('A'.repeat(5000));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreadable');
  });
});
