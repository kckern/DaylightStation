import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { useEffect } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import SurroundHost from "./SurroundHost.jsx";
import { useSurroundOverride } from "./surroundOverride.js";
import { registerSurroundModule } from "./registry.js";
import { SurroundSettingContext } from "./SurroundSettingContext.js";

const makeLogger = () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  log.child = vi.fn(() => log);
  return log;
};

registerSurroundModule('test-rail', () => <div data-testid="rail">rail</div>);

const DATA = { id: 'x', definition: { regions: { right: { module: 'test-rail' } } } };

let mounts = 0;
let api = null;
function Child() {
  api = useSurroundOverride();
  useEffect(() => { mounts += 1; }, []);
  return <video data-testid="vid" />;
}

const handle = { getNowPlaying: () => ({ item: { id: 'a' } }), getMediaElement: () => null };

const tree = (contentId) => (
  <SurroundHost getPlayerHandle={() => handle} contentId={contentId} logger={makeLogger()} pollMs={50}>
    <Child />
  </SurroundHost>
);

afterEach(() => { cleanup(); mounts = 0; api = null; });

describe('SurroundHost override', () => {
  it('open renders the supplied regions; close deactivates without remount', async () => {
    const { queryByTestId } = render(tree('a'));
    expect(queryByTestId('rail')).toBeNull();
    const vid = queryByTestId('vid');
    act(() => api.open(DATA));
    expect(queryByTestId('rail')).not.toBeNull();
    expect(api.isOpen).toBe(true);
    act(() => api.close());
    expect(queryByTestId('rail')).toBeNull();
    expect(queryByTestId('vid')).toBe(vid);
    expect(mounts).toBe(1);
  });

  it('survives the poll', async () => {
    const { queryByTestId } = render(tree('a'));
    act(() => api.open(DATA));
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(queryByTestId('rail')).not.toBeNull();
  });

  it('is cleared when contentId changes', () => {
    const { queryByTestId, rerender } = render(tree('a'));
    act(() => api.open(DATA));
    expect(queryByTestId('rail')).not.toBeNull();
    rerender(tree('b'));
    expect(queryByTestId('rail')).toBeNull();
  });

  it('open is a refused no-op when the surround setting is off', () => {
    const { queryByTestId } = render(
      <SurroundSettingContext.Provider value="off">
        <SurroundHost getPlayerHandle={() => handle} contentId="a" logger={makeLogger()} pollMs={50}>
          <Child />
        </SurroundHost>
      </SurroundSettingContext.Provider>,
    );
    let r;
    act(() => { r = api.open(DATA); });
    expect(r).toBe(false);
    expect(queryByTestId('rail')).toBeNull();
    expect(api.isOpen).toBe(false);
    expect(api.available).toBe(false);
  });

  it('is a no-op outside a host', () => {
    let h;
    function Bare() { h = useSurroundOverride(); return null; }
    render(<Bare />);
    expect(() => { h.open(DATA); h.close(); }).not.toThrow();
    expect(h.isOpen).toBe(false);
  });
});
