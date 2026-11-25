// frontend/src/lib/hooks/useViewportContent.test.jsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewportContent } from './useViewportContent.js';

let meta;
afterEach(() => meta?.remove());
const addMeta = content => {
  meta = document.createElement('meta');
  meta.setAttribute('name', 'viewport');
  if (content !== undefined) meta.setAttribute('content', content);
  document.head.appendChild(meta);
};
const noMeta = () => document.querySelectorAll('meta[name="viewport"]').forEach(m => m.remove());

describe('useViewportContent', () => {
  beforeEach(noMeta);

  it('rewrites the existing viewport tag from the original content and restores it on unmount', () => {
    addMeta('width=device-width, initial-scale=1');
    const update = c => `${c}, maximum-scale=1`;
    const { unmount } = renderHook(() => useViewportContent(update));
    expect(meta.getAttribute('content')).toBe('width=device-width, initial-scale=1, maximum-scale=1');
    unmount();
    expect(meta.getAttribute('content')).toBe('width=device-width, initial-scale=1');
  });

  it('re-applies from the original (not the edited) content when update changes', () => {
    addMeta('a=1');
    const { rerender, unmount } = renderHook(({ fn }) => useViewportContent(fn), { initialProps: { fn: c => `${c},x=1` } });
    expect(meta.getAttribute('content')).toBe('a=1,x=1');
    rerender({ fn: c => `${c},y=2` });
    expect(meta.getAttribute('content')).toBe('a=1,y=2');
    unmount();
    expect(meta.getAttribute('content')).toBe('a=1');
  });

  it('passes an empty string when the tag has no content, and removes the attribute afterwards', () => {
    addMeta(undefined);
    const seen = [];
    const { unmount } = renderHook(() => useViewportContent(c => { seen.push(c); return 'width=1'; }));
    expect(seen[0]).toBe('');
    expect(meta.getAttribute('content')).toBe('width=1');
    unmount();
    expect(meta.hasAttribute('content')).toBe(false);
  });

  it('does nothing and does not throw when the page has no viewport tag', () => {
    let called = false;
    const { unmount } = renderHook(() => useViewportContent(c => { called = true; return c; }));
    unmount();
    expect(called).toBe(false);
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });
});
