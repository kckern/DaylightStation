import { describe, it, expect } from 'vitest';
import { extractScssClasses, extractClassTokens, findViolations } from './audit-css-ownership.mjs';

describe('extractScssClasses', () => {
  it('expands nested &__el / &--mod / &.state against the parent block', () => {
    const cls = extractScssClasses(`
      .card {
        color: red;
        &__title { font-weight: 700; }
        &--wide { width: 100%; }
        &.is-open { display: block; }
        .inner-thing { margin: 0; }
      }`);
    for (const c of ['card', 'card__title', 'card--wide', 'is-open', 'inner-thing']) {
      expect(cls.has(c)).toBe(true);
    }
  });

  it('sees through @media, ignores keyframes, comments and :not() arguments', () => {
    const cls = extractScssClasses(`
      // .commented-out { }
      /* .also-commented { } */
      @media (prefers-reduced-motion: reduce) { .a-b.is-shimmer { animation: none; } }
      @keyframes sweep { from { opacity: 0; } to { opacity: 1; } }
      .x-y:not(.excluded-one) { color: blue; }`);
    expect(cls.has('a-b')).toBe(true);
    expect(cls.has('is-shimmer')).toBe(true);
    expect(cls.has('x-y')).toBe(true);
    expect(cls.has('commented-out')).toBe(false);
    expect(cls.has('also-commented')).toBe(false);
    expect(cls.has('excluded-one')).toBe(false);
  });
});

describe('extractClassTokens', () => {
  it('collects compound tokens from strings and template literals, not comments', () => {
    const tokens = extractClassTokens(`
      // className="comment-only"
      const cls = \`piano-skeleton\${animate ? ' is-shimmer' : ''}\`;
      const el = <div className="staff-skeleton staff-skeleton__line" />;
      const word = 'month';`);
    expect([...tokens].sort()).toEqual(['is-shimmer', 'piano-skeleton', 'staff-skeleton', 'staff-skeleton__line']);
  });
});

describe('findViolations', () => {
  const areas = {
    DemoApp: { entry: 'frontend/src/Apps/DemoApp.jsx', folders: ['frontend/src/modules/Demo/Kiosk/'] },
  };
  const appSheets = { DemoApp: '.demo-shell { } .demo-card { &__title { } } .shared-thing { }' };
  const otherSheets = { 'frontend/src/modules/Other/Other.scss': '.shared-thing { }' };

  it('flags an app-only class used outside the app, ignores its own area and shared classes', () => {
    const jsFiles = {
      'frontend/src/Apps/DemoApp.jsx': '<div className="demo-shell" />',
      'frontend/src/modules/Demo/Kiosk/Card.jsx': '<div className="demo-card__title" />',
      'frontend/src/modules/Demo/Widget.jsx': '<div className="demo-card demo-card__title shared-thing" />',
    };
    const v = findViolations({ appSheets, otherSheets, jsFiles, areas });
    expect(v.map((x) => `${x.app}:${x.cls}:${x.file}`).sort()).toEqual([
      'DemoApp:demo-card:frontend/src/modules/Demo/Widget.jsx',
      'DemoApp:demo-card__title:frontend/src/modules/Demo/Widget.jsx',
    ]);
  });

  it('clears once the class is defined in a stylesheet outside Apps/', () => {
    const jsFiles = { 'frontend/src/modules/Demo/Widget.jsx': '<div className="demo-card" />' };
    const moved = { ...otherSheets, 'frontend/src/modules/Demo/Widget.scss': '.demo-card { }' };
    expect(findViolations({ appSheets, otherSheets: moved, jsFiles, areas })).toEqual([]);
  });
});
