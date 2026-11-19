import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDismissibleError } from './useDismissibleError.js';

describe('useDismissibleError', () => {
  it('hides the dismissed error and shows a later error', () => {
    const firstError = new Error('First read failed');
    const nextError = new Error('Retry failed');
    const { result, rerender } = renderHook(({ error }) => useDismissibleError(error), {
      initialProps: { error: firstError },
    });

    expect(result.current.error).toBe(firstError);
    act(() => result.current.dismiss());
    expect(result.current.error).toBeNull();

    rerender({ error: nextError });
    expect(result.current.error).toBe(nextError);
  });
});
