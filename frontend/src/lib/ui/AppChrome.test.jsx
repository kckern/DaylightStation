import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    const active = screen.getByRole('link', { name: /Today/ });
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  it('fires onTabChange with the tab id', () => {
    const change = vi.fn();
    render(
      <AppChrome title="H" tabs={tabs} activeTab="today" onTabChange={change}>x</AppChrome>
    );
    fireEvent.click(screen.getByRole('link', { name: /Progress/ }));
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
