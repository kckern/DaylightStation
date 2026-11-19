import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useViewScroll } from './useViewScroll.js';

it('restores a ready view once and drops positions when the owner changes', () => {
  const node = document.createElement('main');
  const mainRef = { current: node };
  const { rerender } = renderHook(props => useViewScroll({ mainRef, ...props }), {
    initialProps: { viewKey: 'today', owner: 'one', ready: true },
  });
  node.scrollTop = 120;
  node.dispatchEvent(new Event('scroll'));
  rerender({ viewKey: 'progress', owner: 'one', ready: true });
  expect(node.scrollTop).toBe(0);
  rerender({ viewKey: 'today', owner: 'one', ready: false });
  expect(node.scrollTop).toBe(0);
  rerender({ viewKey: 'today', owner: 'one', ready: true });
  expect(node.scrollTop).toBe(120);
  rerender({ viewKey: 'today', owner: 'two', ready: true });
  expect(node.scrollTop).toBe(0);
});

it('starts a pending destination at the top and waits for its content before restoring', () => {
  const node = document.createElement('main');
  const mainRef = { current: node };
  const { rerender } = renderHook(props => useViewScroll({ mainRef, ...props }), {
    initialProps: { viewKey: 'list', owner: 'one', ready: true },
  });
  node.scrollTop = 240;
  node.dispatchEvent(new Event('scroll'));
  rerender({ viewKey: 'detail', owner: 'one', ready: false });
  expect(node.scrollTop).toBe(0);
  rerender({ viewKey: 'list', owner: 'one', ready: false });
  expect(node.scrollTop).toBe(0);
  rerender({ viewKey: 'list', owner: 'one', ready: true });
  expect(node.scrollTop).toBe(240);
});
