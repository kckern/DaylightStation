import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import DsGallery from './DsGallery.jsx';
import * as ui from '../../lib/ui/index.js';

// Exports that are not visual primitives, or cannot be shown on their own.
// Hooks (use*), constants and createAppLogger are excluded by name below.
const EXEMPT = {
  AppView: 'A visibility wrapper for multi-view shells; it renders no chrome of its own.',
};

const renderGallery = () => render(<MemoryRouter><DsGallery /></MemoryRouter>);

const isComponent = (name) => /^[A-Z][a-z]/.test(name) && typeof ui[name] !== 'undefined' && name !== 'COMPACT_VIEWPORT_QUERY';

function coveredPrimitives(container) {
  const covered = new Set();
  container.querySelectorAll('[data-ds-demo]').forEach(el => {
    el.getAttribute('data-ds-demo').split(/\s+/).filter(Boolean).forEach(n => covered.add(n));
  });
  return covered;
}

describe('DsGallery', () => {
  it('has a gallery entry (or a stated exemption) for every component exported by lib/ui', () => {
    const { container } = renderGallery();
    const covered = coveredPrimitives(container);
    const components = Object.keys(ui).filter(isComponent);
    expect(components.length).toBeGreaterThan(15);
    const missing = components.filter(name => !covered.has(name) && !EXEMPT[name]);
    expect(missing, `add a <Demo primitives="..."> to DsGallery.jsx or an EXEMPT reason: ${missing.join(', ')}`).toEqual([]);
  });

  it('claims no primitive that lib/ui does not export', () => {
    const { container } = renderGallery();
    for (const name of coveredPrimitives(container)) expect(ui[name], name).toBeDefined();
  });

  it('opens the confirm dialog', async () => {
    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
    expect(await screen.findByText('This cannot be undone.')).toBeTruthy();
  });

  it('shows a toast', async () => {
    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Info toast' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });
});
