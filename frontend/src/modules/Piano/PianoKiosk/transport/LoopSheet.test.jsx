import { render, fireEvent, screen } from '@testing-library/react';
import LoopSheet from './LoopSheet.jsx';

describe('LoopSheet', () => {
  const base = { open: true, onClose: vi.fn(), sections: [{ label: 'A section' }] };

  it('picks a section and closes', () => {
    const onPickSection = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} onPickSection={onPickSection} />);
    fireEvent.click(screen.getByRole('button', { name: 'A section' }));
    expect(onPickSection).toHaveBeenCalledWith({ label: 'A section' });
    expect(onClose).toHaveBeenCalled();
  });

  it('when active, nudges with SVG-face buttons and stays open', () => {
    const onNudge = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} active onNudge={onNudge} />);
    const later = screen.getByRole('button', { name: 'Loop start later' });
    expect(later.querySelector('.piano-icon')).not.toBeNull(); // SVG, not '+' text
    fireEvent.click(later);
    expect(onNudge).toHaveBeenCalledWith('in', 1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeInTheDocument();
  });

  it('starts the two-tap measure selection and closes', () => {
    const onStartSelect = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} onStartSelect={onStartSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select measures…' }));
    expect(onStartSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
