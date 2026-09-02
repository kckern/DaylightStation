import { useMemo } from 'react';
import { MantineProvider } from '@mantine/core';
import { createAppTheme } from '../theme/createAppTheme.js';
import { dsCssVars } from '../theme/tokens.mjs';
import { PACKS } from '../theme/packs.mjs';

/**
 * Wraps an app in its themed MantineProvider and a .ds-root div carrying
 * the --ds-* custom properties, so both Mantine components and plain SCSS
 * consume the same token contract.
 */
export function AppThemeProvider({ pack = 'health', forceColorScheme, children }) {
  const packDef = typeof pack === 'string' ? PACKS[pack] : pack;
  const theme = useMemo(() => createAppTheme(packDef), [packDef]);
  const vars = useMemo(() => dsCssVars(packDef), [packDef]);
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme={forceColorScheme}>
      <div className="ds-root" style={{ ...vars, minHeight: '100%' }}>
        {children}
      </div>
    </MantineProvider>
  );
}

export default AppThemeProvider;
