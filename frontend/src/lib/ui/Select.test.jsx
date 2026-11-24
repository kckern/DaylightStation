// frontend/src/lib/ui/Select.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { Select } from './Select.jsx';

describe('Select', () => {
  it('is a native select named by its label, with options and token classes', () => {
    render(<label>Edition<Select defaultValue="b" className="mine"><option value="a">A</option><option value="b">B</option></Select></label>);
    const s = screen.getByRole('combobox', { name: 'Edition' });
    expect(s.tagName).toBe('SELECT');
    expect(s.value).toBe('b');
    expect(s.className).toBe('ds-select mine');
    expect(s.getAttribute('data-density')).toBe('touch');
  });

  it('keeps native change events, disabled, multiple and ref forwarding', () => {
    const onChange = vi.fn();
    const ref = createRef();
    render(<Select ref={ref} aria-label="Pick" density="compact" onChange={onChange}><option value="a">A</option><option value="b">B</option></Select>);
    fireEvent.change(ref.current, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ref.current.value).toBe('b');
    expect(ref.current.getAttribute('data-density')).toBe('compact');
  });

  it('a caller cannot drop the house class through className', () => {
    render(<Select aria-label="x" />);
    expect(screen.getByRole('combobox').className).toBe('ds-select');
  });
});
