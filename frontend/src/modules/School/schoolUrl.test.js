import { describe, it, expect, afterEach } from 'vitest';
import { parseSchoolPath, schoolPathFor } from './SchoolApp.jsx';

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

  it('non-materials sections carry no chain', () => {
    at(`${BASE}/print`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'print', materialPath: [] });
    at(`${BASE}/lang/glossika-korean`);
    expect(parseSchoolPath(BASE)).toEqual({ section: 'lang:glossika-korean', materialPath: [] });
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
