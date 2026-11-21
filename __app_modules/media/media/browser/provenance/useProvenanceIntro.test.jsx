import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, renderHook } from '@testing-library/react';

const state = { data: null, status: 'idle', calls: [] };
vi.mock('./useProvenance.js', () => ({
  useProvenance: (contentId, opts) => { state.calls.push({ contentId, ...opts }); return { data: state.data, status: state.status }; },
}));

const { useProvenanceIntro, provenanceOptedOut } = await import('./useProvenanceIntro.jsx');

const PROV = { provider: 'hoopla', tier: 'free', logoUrl: '/logo?variant=white' };
const PLEX = { media: { assetId: 'plex:42' }, isPlex: true };

beforeEach(() => { state.data = null; state.status = 'idle'; state.calls = []; });
afterEach(() => { window.history.replaceState({}, '', '/'); });

describe('provenanceOptedOut', () => {
  it('reads ?provenance=0', () => {
    expect(provenanceOptedOut('?provenance=0')).toBe(true);
    expect(provenanceOptedOut('?a=1&provenance=0&b=2')).toBe(true);
    expect(provenanceOptedOut('?provenance=1')).toBe(false);
    expect(provenanceOptedOut('')).toBe(false);
  });
});

describe('useProvenanceIntro', () => {
  it('has no intro for a non-Plex title', () => {
    const { result } = renderHook(() => useProvenanceIntro({ media: { assetId: 'x' }, isPlex: false }));
    expect(result.current).toBeNull();
    expect(state.calls.at(-1)).toMatchObject({ contentId: null, enabled: false });
  });

  it('has no intro when opted out with ?provenance=0', () => {
    window.history.replaceState({}, '', '/?provenance=0');
    state.status = 'ready'; state.data = PROV;
    const { result } = renderHook(() => useProvenanceIntro(PLEX));
    expect(result.current).toBeNull();
    expect(state.calls.at(-1)).toMatchObject({ enabled: false });
  });

  it('is pending while the provider loads', () => {
    state.status = 'loading';
    const { result } = renderHook(() => useProvenanceIntro(PLEX));
    expect(result.current.status).toBe('pending');
    expect(state.calls.at(-1)).toMatchObject({ contentId: 'plex:42', enabled: true });
  });

  it('is pending before the fetch starts (idle)', () => {
    const { result } = renderHook(() => useProvenanceIntro(PLEX));
    expect(result.current.status).toBe('pending');
  });

  it('is ready with a 5-10 s hold that stays put across rerenders', () => {
    state.status = 'ready'; state.data = PROV;
    const { result, rerender } = renderHook(() => useProvenanceIntro(PLEX));
    const first = result.current;
    expect(first.status).toBe('ready');
    expect(first.minHoldMs).toBeGreaterThanOrEqual(5000);
    expect(first.minHoldMs).toBeLessThanOrEqual(10000);
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.minHoldMs).toBe(first.minHoldMs);
  });

  it('is none when nothing is confirmed or the lookup failed', () => {
    state.status = 'none';
    const { result, rerender } = renderHook(() => useProvenanceIntro(PLEX));
    expect(result.current.status).toBe('none');
    state.status = 'failed';
    rerender();
    expect(result.current.status).toBe('none');
  });

  it('renders the linking scene while covering', () => {
    state.status = 'ready'; state.data = PROV;
    const { result } = renderHook(() => useProvenanceIntro(PLEX));
    const { container } = render(<>{result.current.render('covering')}</>);
    expect(container.querySelector('.provenance-handoff--linking')).toBeInTheDocument();
  });

  it('renders nothing before the intro covers', () => {
    state.status = 'ready'; state.data = PROV;
    const { result } = renderHook(() => useProvenanceIntro(PLEX));
    const { container } = render(<>{result.current.render('waiting')}</>);
    expect(container.querySelector('.provenance-handoff')).toBeNull();
  });
});
