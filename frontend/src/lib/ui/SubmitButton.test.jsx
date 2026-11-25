// frontend/src/lib/ui/SubmitButton.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider, Button as MantineButton } from '@mantine/core';
import { SubmitButton } from './SubmitButton.jsx';

describe('SubmitButton', () => {
  it('is a submit button that submits its form and calls onClick when available', () => {
    const onSubmit = vi.fn(e => e.preventDefault());
    const onClick = vi.fn();
    render(<form onSubmit={onSubmit}><SubmitButton onClick={onClick}>Save</SubmitButton></form>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('type')).toBe('submit');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('while pending it stays focusable (not disabled), is aria-busy, and blocks click and submit', () => {
    const onSubmit = vi.fn(e => e.preventDefault());
    const onClick = vi.fn();
    render(<form onSubmit={onSubmit}><SubmitButton pending onClick={onClick}>Save</SubmitButton></form>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    b.focus();
    expect(document.activeElement).toBe(b);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocked also suppresses activation without the busy state', () => {
    const onClick = vi.fn();
    render(<SubmitButton blocked onClick={onClick}>Save</SubmitButton>);
    const b = screen.getByRole('button');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.getAttribute('aria-busy')).toBeNull();
  });

  it('an invalid form passes disabled, which natively disables the button', () => {
    render(<SubmitButton disabled>Save</SubmitButton>);
    expect(screen.getByRole('button').disabled).toBe(true);
  });

  it('pending wins over disabled so focus is kept', () => {
    render(<SubmitButton pending disabled>Save</SubmitButton>);
    expect(screen.getByRole('button').disabled).toBe(false);
  });

  it('with Mantine Button it shows a loader while pending and marks data-disabled', () => {
    const onClick = vi.fn();
    const { container } = render(<MantineProvider><SubmitButton as={MantineButton} pending onClick={onClick}>Save</SubmitButton></MantineProvider>);
    const b = screen.getByRole('button', { name: /Save/ });
    expect(b.hasAttribute('data-disabled')).toBe(true);
    expect(container.querySelector('.mantine-Loader-root')).not.toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});
