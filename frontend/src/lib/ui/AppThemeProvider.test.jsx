import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMantineColorScheme } from '@mantine/core';
import { AppThemeProvider } from './AppThemeProvider.jsx';

// Reads/flips the color scheme from inside the tree, so the assertions
// exercise real Mantine color-scheme machinery (MantineProvider's own
// forced-vs-free logic), not just prop plumbing.
function SchemeProbe() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <div>
      <span data-testid="scheme">{colorScheme}</span>
      <button type="button" onClick={() => setColorScheme('light')}>flip</button>
    </div>
  );
}

describe('AppThemeProvider forceColorScheme', () => {
  it('defaults to unforced dark (existing consumers keep changeable color scheme)', () => {
    render(
      <AppThemeProvider pack="health">
        <SchemeProbe />
      </AppThemeProvider>
    );
    expect(screen.getByTestId('scheme').textContent).toBe('dark');
    fireEvent.click(screen.getByText('flip'));
    // No forceColorScheme passed through -> Mantine's setColorScheme is live.
    expect(screen.getByTestId('scheme').textContent).toBe('light');
  });

  it('locks the color scheme to dark when forceColorScheme="dark" is passed (Media requirement)', () => {
    render(
      <AppThemeProvider pack="health" forceColorScheme="dark">
        <SchemeProbe />
      </AppThemeProvider>
    );
    expect(screen.getByTestId('scheme').textContent).toBe('dark');
    fireEvent.click(screen.getByText('flip'));
    // Mantine ignores setColorScheme calls entirely while forced.
    expect(screen.getByTestId('scheme').textContent).toBe('dark');
  });
});

it('isolates Mantine variables and scheme on an explicitly scoped app root', () => {
  const {container} = render(<AppThemeProvider pack="admin" scopeId="admin-theme" forceColorScheme="dark">
    <span>Editor</span>
  </AppThemeProvider>);
  expect(container.querySelector('#admin-theme')?.dataset.mantineColorScheme).toBe('dark');
  expect(container.querySelector('style[data-mantine-styles]')?.textContent).toContain('#admin-theme');
});

it('renders two scoped packs together with independent accents and shared control geometry', () => {
  render(<>
    <AppThemeProvider pack="admin" scopeId="admin-preview"><span>Admin preview</span></AppThemeProvider>
    <AppThemeProvider pack="health" scopeId="health-preview"><span>Health preview</span></AppThemeProvider>
  </>);
  const admin = document.getElementById('admin-preview').style;
  const health = document.getElementById('health-preview').style;
  expect(admin.getPropertyValue('--ds-accent')).toBeTruthy();
  expect(health.getPropertyValue('--ds-accent')).toBeTruthy();
  expect(admin.getPropertyValue('--ds-accent')).not.toBe(health.getPropertyValue('--ds-accent'));
  for (const root of [admin, health]) {
    expect(root.getPropertyValue('--ds-control-touch-target')).toBe('44px');
    expect(root.getPropertyValue('--ds-surface')).toBeTruthy();
  }
});
