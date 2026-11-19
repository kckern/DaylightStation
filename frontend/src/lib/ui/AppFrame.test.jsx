import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppFrame, PlaybackFrame, useAppMainRef } from './AppFrame.jsx';

function MainProbe({ label, read }) {
  const mainRef = useAppMainRef();
  return <button onClick={() => read(mainRef?.current ?? null)}>{label}</button>;
}

describe('AppFrame', () => {
  it('places playback outside the scrolling main and exposes the scroll element', () => {
    const mainRef = createRef();
    render(<AppFrame header="Media" navigation="Browse" footer={<button>Play</button>} mainRef={mainRef}>Results</AppFrame>);
    expect(mainRef.current).toBe(screen.getByRole('main'));
    expect(mainRef.current.contains(screen.getByRole('button'))).toBe(false);
    expect(screen.getByRole('navigation').textContent).toBe('Browse');
  });
  it('omits unused regions', () => {
    const {container} = render(<AppFrame>Article</AppFrame>);
    expect(container.querySelector('header,nav,.ds-chrome__footer')).toBeNull();
  });
  it('exposes main to content and still forwards a caller callback ref', () => {
    const forward = vi.fn();
    const read = vi.fn();
    const { unmount } = render(
      <AppFrame mainRef={forward} footer={<MainProbe label="Outside" read={read} />}>
        <MainProbe label="Inside" read={read} />
      </AppFrame>,
    );
    const main = screen.getByRole('main');
    expect(forward).toHaveBeenLastCalledWith(main);
    fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(read).toHaveBeenLastCalledWith(main);
    fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
    expect(read).toHaveBeenLastCalledWith(null);
    unmount();
    expect(forward).toHaveBeenLastCalledWith(null);
  });
});

it('keeps a persistent player mounted when routed content or compact controls change', () => {
  const view = title => <PlaybackFrame player={<audio data-testid="engine" />} controls={title === 'Browse' && <button>Play</button>}>
    <main key={title}>{title}</main>
  </PlaybackFrame>;
  const {rerender} = render(view('Browse'));
  const engine = screen.getByTestId('engine');
  rerender(view('Search'));
  expect(screen.getByTestId('engine')).toBe(engine);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.queryByRole('button')).toBeNull();
});

it('retains the caller layout class on the frame root for a grouped navigation tree', () => {
  const {container} = render(<AppFrame className="admin-layout" navigation={<a href="/admin">Admin</a>}>Editor</AppFrame>);
  expect(container.firstChild.classList.contains('admin-layout')).toBe(true);
});
