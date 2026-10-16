import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DetailActions from "./DetailActions.jsx";

describe('DetailActions', () => {
  it('shows a plain delete control until armed, then asks to confirm', () => {
    const onDelete = vi.fn();
    const { getByLabelText, rerender } = render(<DetailActions onDelete={onDelete} />);
    expect(getByLabelText('Delete session').textContent).toBe('✕');
    rerender(<DetailActions onDelete={onDelete} deleteArmed />);
    const armed = getByLabelText('Confirm delete');
    expect(armed.textContent).toBe('Delete?');
    expect(armed.classList.contains('session-detail__delete--armed')).toBe(true);
    fireEvent.click(armed);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
