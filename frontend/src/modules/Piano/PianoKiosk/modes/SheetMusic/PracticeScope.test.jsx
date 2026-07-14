import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PracticeScope from './PracticeScope.jsx';

const sections = [{ label: 'A' }, { label: 'B' }];

describe('PracticeScope', () => {
  it('button reflects the current scope label', () => {
    const { rerender } = render(<PracticeScope scopeLabel="Whole piece" sections={sections} />);
    expect(screen.getByRole('button', { name: /practice: whole piece/i })).toBeInTheDocument();
    rerender(<PracticeScope scopeLabel="m9–16" sections={sections} />);
    expect(screen.getByRole('button', { name: /practice: m9–16/i })).toBeInTheDocument();
  });

  it('popover lists sections, Select measures…, and Whole piece; each fires its handler', () => {
    const onPickSection = vi.fn();
    const onStartSelect = vi.fn();
    const onClearFocus = vi.fn();
    render(
      <PracticeScope
        scopeLabel="Whole piece"
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /practice: whole piece/i })); // open
    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    expect(onPickSection).toHaveBeenCalledWith(sections[0]);

    fireEvent.click(screen.getByRole('button', { name: /practice:/i })); // reopen
    fireEvent.click(screen.getByRole('button', { name: /select measures/i }));
    expect(onStartSelect).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /practice:/i }));
    // The "Whole piece" clear option (exact name; distinct from the "Practice: …" trigger).
    fireEvent.click(screen.getByRole('button', { name: 'Whole piece' }));
    expect(onClearFocus).toHaveBeenCalled();
  });
});
