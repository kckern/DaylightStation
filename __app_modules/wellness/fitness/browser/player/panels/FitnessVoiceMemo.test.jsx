import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const ctx = vi.hoisted(() => ({ value: null }));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ctx.value }));
vi.mock('./FitnessVideo.jsx', () => ({ default: () => <div data-testid="cam" /> }));

import FitnessVoiceMemo from './FitnessVoiceMemo.jsx';

describe('FitnessVoiceMemo camera-panel buttons', () => {
  it('names its buttons for what they do, with icons rather than glyphs', () => {
    ctx.value = { voiceMemos: [], openVoiceMemoCapture: vi.fn() };
    const onToggleMenu = vi.fn();
    render(<FitnessVoiceMemo onToggleMenu={onToggleMenu} />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    const record = screen.getByRole('button', { name: 'Record a voice memo' });
    expect(settings.querySelector('svg')).toBeTruthy();
    expect(record.querySelector('svg')).toBeTruthy();
    fireEvent.click(settings);
    expect(onToggleMenu).toHaveBeenCalledTimes(1);
    fireEvent.click(record);
    expect(ctx.value.openVoiceMemoCapture).toHaveBeenCalledWith(null);
  });

  it('shows the memo count as its own named button', () => {
    ctx.value = { voiceMemos: [{}, {}], openVoiceMemoList: vi.fn() };
    render(<FitnessVoiceMemo onToggleMenu={() => {}} />);
    const list = screen.getByRole('button', { name: '2 voice memos' });
    expect(list.textContent).toBe('2');
  });
});
