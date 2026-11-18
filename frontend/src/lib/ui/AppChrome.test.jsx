import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppChrome } from './AppChrome.jsx';

const tabs = [
  { id: 'today', label: 'Today', icon: <svg data-testid="i1" /> },
  { id: 'progress', label: 'Progress', icon: <svg data-testid="i2" /> },
];

describe('AppChrome', () => {
  it('renders title, tabs, children; marks the active tab', () => {
    render(
      <AppChrome title="Health" tabs={tabs} activeTab="today" onTabChange={() => {}}>
        <p>content</p>
      </AppChrome>
    );
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
    const active = screen.getByRole('button', { name: /Today/ });
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  it('fires onTabChange with the tab id', () => {
    const change = vi.fn();
    render(
      <AppChrome title="H" tabs={tabs} activeTab="today" onTabChange={change}>x</AppChrome>
    );
    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));
    expect(change).toHaveBeenCalledWith('progress');
  });

  it('throws when given more than 3 header actions', () => {
    expect(() =>
      render(
        <AppChrome title="H" tabs={tabs} activeTab="today" onTabChange={() => {}}
          headerActions={[<b key="1" />, <b key="2" />, <b key="3" />, <b key="4" />]}>
          x
        </AppChrome>
      )
    ).toThrow(/3 header actions/);
  });
});

it('exposes the main scroll element and its footer sibling through the frame', () => {
  const mainRef = { current: null };
  render(<AppChrome title="Home" mainRef={mainRef} footer={<button>Player</button>}>Rooms</AppChrome>);
  expect(mainRef.current).toBe(screen.getByRole('main'));
  expect(mainRef.current.contains(screen.getByRole('button', { name: 'Player' }))).toBe(false);
});

it('routes links, delegates local choices, and keeps header actions independent of selection', () => {
  const change = vi.fn();
  const search = vi.fn();
  function Dashboard() {
    const { pathname } = useLocation();
    return <AppChrome title="Dashboard"
      tabs={[{ id: 'plan', label: 'Plan', href: '/plan' }, { id: 'rooms', label: 'Rooms' }]}
      activeTab={pathname === '/plan' ? 'plan' : 'rooms'}
      onTabChange={change} headerActions={<button onClick={search}>Search</button>}>
      {pathname}
    </AppChrome>;
  }
  const { container } = render(<MemoryRouter><Dashboard /></MemoryRouter>);
  const plan = screen.getByRole('link', { name: 'Plan' });
  fireEvent.click(plan);
  expect(screen.getByRole('main').textContent).toBe('/plan');
  expect(plan.getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Rooms' }));
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(change.mock.calls).toEqual([['rooms']]);
  expect(search).toHaveBeenCalledTimes(1);
  expect(plan.getAttribute('aria-current')).toBe('page');
  expect(container.querySelector('.ds-chrome__footer')).toBeNull();
});
