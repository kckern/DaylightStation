import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useAlignment.js', () => ({
  useAlignment: () => ({ data: { dashboard: { stage: 'scaffolding', completeness: { hasPurpose: false, valueCount: 1, goalCount: 0, beliefCount: 0 } } }, loading: false }),
}));
import { useLifeStage } from './useLifeStage.js';

describe('useLifeStage', () => {
  it('surfaces stage + completeness from the alignment dashboard', () => {
    const { result } = renderHook(() => useLifeStage());
    expect(result.current.stage).toBe('scaffolding');
    expect(result.current.completeness.valueCount).toBe(1);
  });
});
