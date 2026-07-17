import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CadenceIndicator } from './CadenceIndicator.jsx';

describe('CadenceIndicator', () => {
  it('shows a human period label, not the raw periodId', () => {
    const { container } = render(
      <MantineProvider>
        <CadenceIndicator cadencePosition={{ unit: { level: 'unit', periodId: '2026-07-17' } }} />
      </MantineProvider>
    );
    expect(container.textContent).toContain('Jul 17');
    expect(container.textContent).not.toContain('2026-07-17');
  });
});
