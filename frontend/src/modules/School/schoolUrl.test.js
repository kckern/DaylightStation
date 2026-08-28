import { describe, it, expect, afterEach } from 'vitest';
import { parseSchoolPath, schoolPathFor } from './schoolPathModel.js';

// parseSchoolPath reads window.location.pathname; set it per case.
function at(pathname) {
  window.history.replaceState({}, '', pathname);
}
afterEach(() => at('/'));

const BASE = '/screens/portal';

describe('parseSchoolPath — full materials chain', () => {
  it('parses a subject with no chain', () => {
    at(`${BASE}/subject/history`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'subject:history', materialPath: [] });
  });

  it('parses a bare collection → work → track chain, assuming plex: per segment', () => {
    at(`${BASE}/subject/history/483194/483214/483215`);
    expect(parseSchoolPath(BASE)).toEqual({
      section: 'subject:history',
      materialPath: ['plex:483194', 'plex:483214', 'plex:483215'],
    });
  });

  it('a non-plex prefixed id keeps its own prefix (round-trips unchanged)', () => {
    at(`${BASE}/subject/history/local:abc`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'subject:history', materialPath: ['local:abc'] });
  });

  it('parses a library chain', () => {
    at(`${BASE}/library/1/2`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'library', materialPath: ['plex:1', 'plex:2'] });
  });

  it('non-materials sections carry no chain and protected language routes do not restore authority', () => {
    at(`${BASE}/print`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'print', materialPath: [] });
    at(`${BASE}/lang/glossika-korean`);
    expect(parseSchoolPath(BASE)).toEqual({ section: null, materialPath: [] });
  });

  it('works under the /app/school base too', () => {
    at('/app/school/subject/math/489954/489956');
    expect(parseSchoolPath('/app/school')).toEqual({
      section: 'subject:math',
      materialPath: ['plex:489954', 'plex:489956'],
    });
  });
});

describe('schoolPathFor — round-trips the chain', () => {
  it('composes section + chain with bare ids (plex: stripped)', () => {
    expect(schoolPathFor(BASE, 'subject:history', ['plex:483194', 'plex:483214', 'plex:483215']))
      .toBe(`${BASE}/subject/history/483194/483214/483215`);
  });

  it('a section with no chain is just the section path', () => {
    expect(schoolPathFor(BASE, 'subject:history', [])).toBe(`${BASE}/subject/history`);
    expect(schoolPathFor(BASE, 'print', [])).toBe(`${BASE}/print`);
  });

  it('non-materials sections never carry a chain even if one is passed', () => {
    expect(schoolPathFor(BASE, 'progress', ['plex:1'])).toBe(`${BASE}/progress`);
  });

  it('round-trips through parseSchoolPath (encode → parse → same ids)', () => {
    const chain = ['plex:483194', 'plex:483214', 'plex:483215'];
    const path = schoolPathFor(BASE, 'subject:history', chain);
    at(path);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'subject:history', materialPath: chain });
  });
});

describe('launch-card preview deep link', () => {
  // Teacher-only, like the sentence-ladder preview beside it: the segment is an
  // opaque payload the backend decodes, and no learner authority is restored
  // from it. `parseSchoolPath` must carry it through byte-for-byte — a payload
  // it re-encoded or truncated would resolve to a different card than the link
  // that was shared.
  const PAYLOAD = 'eyJsZWFybmVySWQiOiJmZWxpeCIsInN1YmplY3QiOiJhcnRzIn0';

  it('parses the payload segment into a preview section', () => {
    at(`${BASE}/launch-preview/${PAYLOAD}`);
    expect(parseSchoolPath(BASE)).toEqual({ section: `launch-preview:${PAYLOAD}`, materialPath: [] });
  });

  it('builds the same path back', () => {
    expect(schoolPathFor(BASE, `launch-preview:${PAYLOAD}`)).toBe(`${BASE}/launch-preview/${PAYLOAD}`);
  });

  it('round-trips an unreadable payload rather than dropping it — the panel says why', () => {
    at(`${BASE}/launch-preview/not-a-payload`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'launch-preview:not-a-payload', materialPath: [] });
  });

  it('carries no materials chain', () => {
    at(`${BASE}/launch-preview/${PAYLOAD}/483194`);
    expect(parseSchoolPath(BASE).materialPath).toEqual([]);
  });

  it('a bare /launch-preview with no payload is not a section', () => {
    at(`${BASE}/launch-preview`);
    expect(parseSchoolPath(BASE)).toEqual({ section: null, materialPath: [] });
  });
});

describe('geography section', () => {
  it('builds the geography section path', () => {
    expect(schoolPathFor(BASE, 'geography')).toBe(`${BASE}/geography`);
  });
  it('parses the geography section path', () => {
    at(`${BASE}/geography`);
    expect(parseSchoolPath(BASE).section).toBe('geography');
  });
});
