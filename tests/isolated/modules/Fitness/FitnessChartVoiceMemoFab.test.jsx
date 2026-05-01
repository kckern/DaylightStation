import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import FitnessChartVoiceMemoFab from '@/modules/Fitness/player/FitnessChartVoiceMemoFab.jsx';

afterEach(() => cleanup());

describe('FitnessChartVoiceMemoFab', () => {
  it('renders a button with an aria-label when sessionActive is true', () => {
    const { getByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive onRecord={() => {}} />
    );
    expect(getByLabelText('Record voice memo')).toBeTruthy();
  });

  it('renders nothing when sessionActive is false', () => {
    const { queryByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive={false} onRecord={() => {}} />
    );
    expect(queryByLabelText('Record voice memo')).toBeNull();
  });

  it('calls onRecord when the button is clicked', () => {
    const handler = vi.fn();
    const { getByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive onRecord={handler} />
    );
    fireEvent.click(getByLabelText('Record voice memo'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
