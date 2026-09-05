/**
 * The query string survives the redirect.
 *
 * This suite exists because of a bug with no symptom: the bare `/school` route
 * was a string-target `<Navigate to="/app/school">`, which discards `search`.
 * The teacher console's "Preview launch card" 302s to
 * `/school?preview=<signed token>`; the token was silently dropped and the
 * popup rendered the locked keypad instead of the card. Nothing threw, nothing
 * 404'd, nothing was logged — the only way to see it was to click the button
 * and recognise the wrong surface.
 *
 * So each case below asserts the WHOLE destination — pathname AND search —
 * because asserting the pathname alone is exactly what would have passed while
 * the feature was broken.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import {
  OfficeRedirect,
  TVRedirect,
  SchoolDeepLinkRedirect,
  TeacherNextRedirect,
} from './routeRedirects.jsx';

let landed = null;
function Landing() {
  const { pathname, search } = useLocation();
  landed = `${pathname}${search}`;
  return null;
}

/** Mount `element` at `route`, follow the redirect, and report where it landed. */
function redirect(from, route, element) {
  landed = null;
  render(
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
  return landed;
}

describe('routeRedirects — the query string is part of the destination', () => {
  it('carries ?preview= through the BARE /school redirect (the launch-card preview bug)', () => {
    const token = 'eyJwdXJwb3NlIjoic2Nob29sLmxhdW5jaC1wcmV2aWV3In0.sig';
    expect(redirect(`/school?preview=${token}`, '/school', <SchoolDeepLinkRedirect />))
      .toBe(`/app/school?preview=${token}`);
  });

  it('carries the query through a /school DEEP link too', () => {
    expect(redirect('/school/subject/english?foo=1', '/school/*', <SchoolDeepLinkRedirect />))
      .toBe('/app/school/subject/english?foo=1');
  });

  it('leaves a query-less /school alone rather than appending a bare ?', () => {
    expect(redirect('/school', '/school', <SchoolDeepLinkRedirect />)).toBe('/app/school');
  });

  it('keeps School deep-link segments intact', () => {
    expect(redirect('/school/launch-preview/abc123', '/school/*', <SchoolDeepLinkRedirect />))
      .toBe('/app/school/launch-preview/abc123');
  });

  it('carries the autoplay params through /tv', () => {
    expect(redirect('/tv?queue=Cartoons&shuffle=1', '/tv', <TVRedirect />))
      .toBe('/screen/living-room?queue=Cartoons&shuffle=1');
  });

  it('rewrites the teacher-next alias, keeping sub-path and query', () => {
    expect(redirect('/school/teacher-next/students/user_4?tab=day', '/school/teacher-next/*', <TeacherNextRedirect />))
      .toBe('/school/teacher/students/user_4?tab=day');
  });

  it('DROPS the query for /office, which reads its config from screens/office.yml', () => {
    expect(redirect('/office?stale=1', '/office', <OfficeRedirect />)).toBe('/screen/office');
  });
});
