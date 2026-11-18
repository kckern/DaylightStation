import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppFrame, PlaybackFrame } from './AppFrame.jsx';

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
