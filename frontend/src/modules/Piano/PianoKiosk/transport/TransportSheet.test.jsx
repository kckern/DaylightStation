import { render, fireEvent, screen } from '@testing-library/react';
import TransportSheet from './TransportSheet.jsx';

describe('TransportSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<TransportSheet open={false} title="Key" onClose={() => {}}>x</TransportSheet>);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with title, children, and closes via the close button', () => {
    const onClose = vi.fn();
    render(<TransportSheet open title="Key" onClose={onClose}><p>body</p></TransportSheet>);
    const dialog = screen.getByRole('dialog', { name: 'Key' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Key' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on scrim tap', () => {
    const onClose = vi.fn();
    const { container } = render(<TransportSheet open title="Tempo" onClose={onClose}>x</TransportSheet>);
    fireEvent.click(container.querySelector('.piano-tsheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
