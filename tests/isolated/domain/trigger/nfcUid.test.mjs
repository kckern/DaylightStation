// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

describe('canonicalizeNfcUid', () => {
  it('folds the two spellings of one physical card onto the same identity', () => {
    // The bug this exists for: the audiobook readers write separated lowercase,
    // the omr-relay's ST25R3916 reports packed uppercase. Same NTAG 215.
    const fromConfig = canonicalizeNfcUid('04_66_9c_0f_cb_2a_81');
    const fromRelay = canonicalizeNfcUid('04669C0FCB2A81');
    expect(fromRelay).toBe(fromConfig);
    expect(fromConfig).toBe('04669c0fcb2a81');
  });

  it.each([
    ['underscores', '04_66_9C_0F_CB_2A_81'],
    ['colons', '04:66:9c:0f:cb:2a:81'],
    ['hyphens', '04-66-9C-0F-CB-2A-81'],
    ['spaces', '04 66 9c 0f cb 2a 81'],
    ['already canonical', '04669c0fcb2a81'],
    ['surrounding whitespace', '  04669C0FCB2A81\n'],
  ])('accepts %s', (_label, input) => {
    expect(canonicalizeNfcUid(input)).toBe('04669c0fcb2a81');
  });

  it('keeps short legacy registry keys usable', () => {
    // `1001` and `83_8e_68_06` are real entries in the live registry. A
    // canonicalizer that validated length or hex would silently drop them.
    expect(canonicalizeNfcUid('1001')).toBe('1001');
    expect(canonicalizeNfcUid('83_8e_68_06')).toBe('838e6806');
  });

  it.each([[null], [undefined], ['']])('returns empty for %s rather than throwing', (input) => {
    expect(canonicalizeNfcUid(input)).toBe('');
  });

  it('does not merge two genuinely different tags', () => {
    expect(canonicalizeNfcUid('04_66_9c_0f_cb_2a_81'))
      .not.toBe(canonicalizeNfcUid('04_66_9c_0f_cc_2a_81'));
  });
});
