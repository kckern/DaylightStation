import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PianoBreadcrumbProvider, usePianoBreadcrumb, usePianoBreadcrumbBar } from './PianoBreadcrumbContext.jsx';

/** Publisher: re-renders with whatever crumbs the test passes it. */
function Publisher({ crumbs }) {
  usePianoBreadcrumb(crumbs);
  return null;
}

/** Consumer: renders the current crumbs' images so the test can assert on them. */
function Consumer() {
  const { crumbs } = usePianoBreadcrumbBar();
  return (
    <div data-testid="images">
      {(crumbs || []).map((c) => c.image || 'none').join(',')}
    </div>
  );
}

describe('PianoBreadcrumbContext', () => {
  it('re-publishes when a crumb image lands after the label already published (splash-image race)', () => {
    const { rerender } = render(
      <PianoBreadcrumbProvider>
        <Publisher crumbs={[{ label: 'Super Mario Theme' }]} />
        <Consumer />
      </PianoBreadcrumbProvider>,
    );
    expect(screen.getByTestId('images').textContent).toBe('none');

    // Same label, image arrives late (e.g. a splash-image fetch that resolved
    // after the XML fetch mounted the crumb) — must still re-publish.
    rerender(
      <PianoBreadcrumbProvider>
        <Publisher crumbs={[{ label: 'Super Mario Theme', image: '/img/mario.jpg' }]} />
        <Consumer />
      </PianoBreadcrumbProvider>,
    );

    expect(screen.getByTestId('images').textContent).toBe('/img/mario.jpg');
  });
});
