import { render, fireEvent, screen } from '@testing-library/react';
import KeySheet from './KeySheet.jsx';

describe('KeySheet', () => {
  it('renders 13 offsets with the current one lit and picks a value', () => {
    const onPick = vi.fn();
    render(<KeySheet open onClose={() => {}} value={2} onPick={onPick} />);
    expect(screen.getByRole('dialog', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^[+-]?\d$/ })).toHaveLength(13);
    expect(screen.getByRole('button', { name: '+2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '-3' }));
    expect(onPick).toHaveBeenCalledWith(-3);
  });

  it('shows the sounding key when the written key is known', () => {
    render(<KeySheet open onClose={() => {}} value={1} onPick={() => {}} keyFifths={0} keyMode="major" />);
    expect(screen.getByText(/Sounding key: C# major/)).toBeInTheDocument();
  });

  it('omits the footer when the written key is unknown', () => {
    render(<KeySheet open onClose={() => {}} value={1} onPick={() => {}} />);
    expect(screen.queryByText(/Sounding key/)).toBeNull();
  });

  it('labels cells with sounding key names when the written key is known', () => {
    render(<KeySheet open onClose={() => {}} value={0} onPick={() => {}} keyFifths={0} keyMode="major" />);
    const plus2 = screen.getByRole('button', { name: /D major/ });
    expect(plus2.textContent).toContain('+2');
    expect(screen.getByRole('button', { name: /C major/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to offset labels when the key is unknown', () => {
    render(<KeySheet open onClose={() => {}} value={2} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: '+2' })).toHaveAttribute('aria-pressed', 'true');
  });
});
