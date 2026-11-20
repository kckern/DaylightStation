import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/hardReload.js', () => ({ __esModule: true, default: vi.fn() }));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ({}), FITNESS_DEBUG: false }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ __esModule: true, default: () => null }));
vi.mock('./ControllersOverlay.jsx', () => ({
  __esModule: true,
  default: ({ open, onClose }) => (open ? <div data-testid="controllers-overlay"><button onClick={onClose}>x</button></div> : null),
}));

import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — Controllers', () => {
  const renderMenu = (onClose = vi.fn()) => render(
    <FitnessSidebarMenu onClose={onClose} visibility={{}} onToggleVisibility={vi.fn()} onToggleMusic={vi.fn()} appMode="menu" />,
  );

  it('opens the controllers overlay from the Tools section', () => {
    renderMenu();
    expect(screen.queryByTestId('controllers-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    expect(screen.getByTestId('controllers-overlay')).toBeTruthy();
  });

  it('Escape inside the overlay does not also close the menu', () => {
    const onClose = vi.fn();
    renderMenu(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    fireEvent.keyDown(screen.getByTestId('controllers-overlay'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
