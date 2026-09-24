import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { ScreenProvider } from './ScreenProvider.jsx';
import { useScreen } from './useScreen.js';

const config = {
  children: [
    { id: 'left-area', children: [{ widget: 'list' }] },
    { id: 'right-area', basis: '66%', children: [{ widget: 'momentum' }] },
  ],
};

function wrapperWith(props) {
  return function Wrapper({ children }) {
    return <ScreenProvider config={config} {...props}>{children}</ScreenProvider>;
  };
}

describe('ScreenProvider initialReplacements', () => {
  it('applies a seeded replacement on the first render, keeping layout props', () => {
    const seed = { 'right-area': { children: [{ widget: 'detail', props: { sessionId: 's1' } }] } };
    const { result } = renderHook(() => useScreen(), { wrapper: wrapperWith({ initialReplacements: seed }) });

    const { node, replaced } = result.current.getNode('right-area');
    expect(replaced).toBe(true);
    expect(node.children[0]).toEqual({ widget: 'detail', props: { sessionId: 's1' } });
    expect(node.basis).toBe('66%');
  });

  it('restore() clears a seeded replacement back to the original content', () => {
    const seed = { 'right-area': { children: [{ widget: 'detail' }] } };
    const { result } = renderHook(() => useScreen(), { wrapper: wrapperWith({ initialReplacements: seed }) });

    act(() => result.current.restore('right-area'));

    const { node, replaced } = result.current.getNode('right-area');
    expect(replaced).toBe(false);
    expect(node.children[0].widget).toBe('momentum');
  });

  it('renders the original config when no seed is given', () => {
    const { result } = renderHook(() => useScreen(), { wrapper: wrapperWith({}) });
    expect(result.current.getNode('right-area').replaced).toBe(false);
  });
});
