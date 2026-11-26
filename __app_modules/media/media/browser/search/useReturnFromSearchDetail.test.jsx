import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let navState;
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => navState }));
import { useReturnFromSearchDetail } from "./useReturnFromSearchDetail.js";

describe('useReturnFromSearchDetail', () => {
  it('fires once on Back from an info view the search opened, not on the way in or for other details', () => {
    const onReturn = vi.fn();
    navState = { view: 'home', params: {}, depth: 1 };
    const { rerender } = renderHook(() => useReturnFromSearchDetail(onReturn));
    navState = { view: 'detail', params: { contentId: 'plex:1', focusPlay: true, from: 'search' }, depth: 2 };
    rerender();
    expect(onReturn).not.toHaveBeenCalled();
    navState = { view: 'home', params: {}, depth: 1 };
    rerender();
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(onReturn).toHaveBeenCalledWith({ contentId: 'plex:1' });
    // A detail opened some other way: Back does not bring the search back.
    navState = { view: 'detail', params: { contentId: 'plex:2' }, depth: 2 };
    rerender();
    navState = { view: 'home', params: {}, depth: 1 };
    rerender();
    // Going forward from a search detail (into browse) is not a return.
    navState = { view: 'detail', params: { contentId: 'plex:3', from: 'search' }, depth: 2 };
    rerender();
    navState = { view: 'browse', params: { path: 'x' }, depth: 3 };
    rerender();
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
