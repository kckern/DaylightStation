import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hardReloadSpy = vi.fn();
vi.mock('../../lib/hardReload.js', () => ({
  __esModule: true,
  default: (...args) => hardReloadSpy(...args)
}));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({}),
  FITNESS_DEBUG: false
}));

// FeedbackOverlay drags in recording infrastructure irrelevant to this test.
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({
  __esModule: true,
  default: () => null
}));

import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — Reload App', () => {
  beforeEach(() => { hardReloadSpy.mockClear(); });

  const renderMenu = () => render(
    <FitnessSidebarMenu
      onClose={vi.fn()}
      visibility={{}}
      onToggleVisibility={vi.fn()}
      onToggleMusic={vi.fn()}
      appMode="menu"
    />
  );

  it('renders a Reload App item in settings mode', () => {
    renderMenu();
    expect(screen.getByText(/Reload App/)).toBeInTheDocument();
  });

  it('fires hardReload with the settings-menu source on pointer down', () => {
    renderMenu();
    fireEvent.pointerDown(screen.getByText(/Reload App/));
    expect(hardReloadSpy).toHaveBeenCalledTimes(1);
    expect(hardReloadSpy).toHaveBeenCalledWith('settings-menu');
  });
});
