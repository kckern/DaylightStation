import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScreenHeader from './ScreenHeader.jsx';

describe('ScreenHeader', () => {
  it('a root view has one exit: Done, and no Back', () => {
    const done = vi.fn();
    render(<ScreenHeader title="Reading" onDone={done} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('screen-header-back')).toBeNull();
  });

  it('a sub-view adds Back as a step within the screen, sentence case, with an icon', () => {
    const back = vi.fn();
    render(<ScreenHeader title="Reading" onBack={back} onDone={() => {}} />);
    const backButton = screen.getByRole('button', { name: 'Back' });
    expect(backButton.querySelector('svg')).not.toBeNull();
    fireEvent.click(backButton);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a disabled Back does nothing', () => {
    const back = vi.fn();
    render(<ScreenHeader onBack={back} backDisabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).not.toHaveBeenCalled();
  });

  it('carries the identity beside the title', () => {
    render(<ScreenHeader title="Reading" identity={<span data-testid="chip">Kid</span>} />);
    expect(screen.getByTestId('screen-header').querySelector('.school-screen-header__identity [data-testid="chip"]')).not.toBeNull();
  });
});
