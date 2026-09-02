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
