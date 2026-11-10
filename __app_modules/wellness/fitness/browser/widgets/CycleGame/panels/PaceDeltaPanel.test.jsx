import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import PaceDeltaPanel from "./PaceDeltaPanel.jsx";

afterEach(cleanup);

const view = (props) => render(<PaceDeltaPanel rivalName="Rider A" rivalKind="self" {...props} />);
const root = (v) => v.getByTestId('pace-delta');
const headline = (v) => v.container.querySelector('.cg-pace__headline');
const sub = (v) => v.container.querySelector('.cg-pace__rival');
const arrow = (v) => v.container.querySelector('.cg-pace__arrow svg');

describe('PaceDeltaPanel', () => {
  it('shows seconds ahead with word, arrow, class and label', () => {
    const v = view({ delta: { gapM: 20, gapS: 4.4, ahead: true } });
    expect(headline(v).textContent).toBe('4 s');
    expect(v.container.querySelector('.cg-pace__dir').textContent).toBe('ahead');
    expect(root(v).className).toContain('is-ahead');
    expect(root(v).className).not.toContain('is-behind');
    expect(arrow(v)).toBeTruthy();
    expect(root(v).getAttribute('aria-label')).toBe('4 seconds ahead of your best');
    expect(root(v).getAttribute('role')).toBe('status');
    expect(root(v).getAttribute('aria-live')).toBe('off');
  });

  it('shows seconds behind using the absolute value', () => {
    const v = view({ delta: { gapM: -20, gapS: -7.6, ahead: false } });
    expect(headline(v).textContent).toBe('8 s');
    expect(v.container.querySelector('.cg-pace__dir').textContent).toBe('behind');
    expect(root(v).className).toContain('is-behind');
    expect(arrow(v)).toBeTruthy();
    expect(root(v).getAttribute('aria-label')).toBe('8 seconds behind your best');
  });

  it('uses a singular unit for one second', () => {
    const v = view({ delta: { gapM: 5, gapS: 1.2, ahead: true } });
    expect(root(v).getAttribute('aria-label')).toBe('1 second ahead of your best');
  });

  it('falls back to metres when gapS is null (ahead)', () => {
    const v = view({ delta: { gapM: 31.4, gapS: null, ahead: true }, rivalKind: 'par' });
    expect(headline(v).textContent).toBe('31 m');
    expect(root(v).className).toContain('is-ahead');
    expect(root(v).getAttribute('aria-label')).toBe('31 metres ahead of par pace');
  });

  it('falls back to metres when gapS is null (behind)', () => {
    const v = view({ delta: { gapM: -31.4, gapS: null, ahead: false }, rivalKind: 'par' });
    expect(headline(v).textContent).toBe('31 m');
    expect(root(v).className).toContain('is-behind');
    expect(root(v).getAttribute('aria-label')).toBe('31 metres behind par pace');
  });

  it('shows Level when the rounded gap is 0', () => {
    const v = view({ delta: { gapM: 0.3, gapS: 0.4, ahead: true } });
    expect(headline(v).textContent).toBe('Level');
    expect(root(v).className).toContain('is-level');
    expect(root(v).className).not.toContain('is-ahead');
    expect(v.container.querySelector('.cg-pace__dir')).toBeNull();
    expect(arrow(v)).toBeNull();
    expect(root(v).getAttribute('aria-label')).toBe('Level with your best');
  });

  it('reads Level with a named household rival', () => {
    const v = view({ delta: { gapM: 0, gapS: 0, ahead: true }, rivalKind: 'household' });
    expect(root(v).getAttribute('aria-label')).toBe("Level with Rider A's best");
  });

  it('names the rival per kind in the sub-line', () => {
    const d = { gapM: 5, gapS: 2, ahead: true };
    expect(sub(view({ delta: d, rivalKind: 'self' })).textContent).toBe('vs your best');
    cleanup();
    expect(sub(view({ delta: d, rivalKind: 'household' })).textContent).toBe("vs Rider A's best");
    cleanup();
    expect(sub(view({ delta: d, rivalKind: 'par' })).textContent).toBe('vs par pace');
    cleanup();
    expect(sub(view({ delta: d, rivalKind: 'ghost' })).textContent).toBe('vs Rider A');
    cleanup();
    expect(sub(view({ delta: d, rivalKind: 'other' })).textContent).toBe('vs Rider A');
  });

  it('renders a placeholder for a null delta', () => {
    const v = view({ delta: null });
    expect(headline(v).textContent).toBe('—');
    expect(sub(v).textContent).toBe('vs your best');
    expect(v.container.querySelector('.cg-pace__dir')).toBeNull();
    expect(arrow(v)).toBeNull();
    expect(root(v).className).not.toMatch(/is-(ahead|behind|level)/);
    expect(root(v).getAttribute('role')).toBe('status');
    expect(root(v).getAttribute('aria-label')).toBe('No pace comparison yet against your best');
  });

  it('picks the size class from zoneBox height', () => {
    const d = { gapM: 5, gapS: 2, ahead: true };
    expect(root(view({ delta: d })).className).toContain('cg-pace--md');
    cleanup();
    expect(root(view({ delta: d, zoneBox: { width: 300, height: 120 } })).className).toContain('cg-pace--sm');
    cleanup();
    expect(root(view({ delta: d, zoneBox: { width: 300, height: 200 } })).className).toContain('cg-pace--md');
    cleanup();
    expect(root(view({ delta: d, zoneBox: { width: 300, height: 400 } })).className).toContain('cg-pace--lg');
  });
});
