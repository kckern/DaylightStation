/**
 * ScanStatusChip — the shelf's answer to "did it get my scan?" (book-scan
 * experience task 3). The copy is the contract: a child reads these words.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScanStatusChip from "./ScanStatusChip.jsx";

describe('ScanStatusChip', () => {
  it('acknowledges a scan the moment it lands', () => {
    render(<ScanStatusChip acknowledging waiting={0} />);
    expect(screen.getByRole('status').textContent).toBe('Got it — looking it up');
  });

  it('counts one waiting book in the singular', () => {
    render(<ScanStatusChip acknowledging={false} waiting={1} />);
    expect(screen.getByRole('status').textContent).toBe('1 more book waiting');
  });

  it('counts several waiting books in the plural', () => {
    render(<ScanStatusChip acknowledging={false} waiting={3} />);
    expect(screen.getByRole('status').textContent).toBe('3 more books waiting');
  });

  it('says both when a scan lands while others wait', () => {
    render(<ScanStatusChip acknowledging waiting={2} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Got it — looking it up');
    expect(status.textContent).toContain('2 more books waiting');
  });

  it('lists a superseded book with what to do about it', () => {
    render(<ScanStatusChip acknowledging={false} waiting={1} superseded={[{ id: 'c1', label: '9780064400558' }]} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('1 more book waiting');
    expect(status.textContent).toContain('9780064400558');
    expect(status.textContent).toContain('scan it again to open it');
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<ScanStatusChip acknowledging={false} waiting={0} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
