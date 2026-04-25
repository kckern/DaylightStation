import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { RetryImg } from './RetryImg.jsx';

describe('RetryImg', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an img with the original src on first attempt (no cache-bust)', () => {
    const { container } = render(<RetryImg src="/thumbs/foo.png" alt="foo" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/thumbs/foo.png');
  });

  it('returns the fallback element immediately when src is empty', () => {
    const fallback = <span data-testid="ph">missing</span>;
    const { container, queryByTestId } = render(
      <RetryImg src="" alt="x" fallback={fallback} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(queryByTestId('ph')).toBeTruthy();
  });

  it('on error, retries with a cache-bust query param after the backoff delay', () => {
    const { container } = render(<RetryImg src="/thumbs/foo.png" alt="foo" />);
    const img = container.querySelector('img');

    fireEvent.error(img);

    // Before backoff elapses, src has not changed.
    let current = container.querySelector('img');
    expect(current.getAttribute('src')).toBe('/thumbs/foo.png');

    // Advance past 600ms backoff.
    act(() => { vi.advanceTimersByTime(600); });

    current = container.querySelector('img');
    expect(current).toBeTruthy();
    expect(current.getAttribute('src')).toBe('/thumbs/foo.png?_r=1');
  });

  it('appends cache-bust with & when src already contains ?', () => {
    const { container } = render(<RetryImg src="/thumbs/foo.png?v=2" alt="foo" />);
    fireEvent.error(container.querySelector('img'));
    act(() => { vi.advanceTimersByTime(600); });

    expect(container.querySelector('img').getAttribute('src')).toBe('/thumbs/foo.png?v=2&_r=1');
  });

  it('renders the fallback after exhausting maxRetries', () => {
    const fallback = <span data-testid="ph">missing</span>;
    const { container, queryByTestId } = render(
      <RetryImg src="/thumbs/foo.png" alt="foo" maxRetries={2} fallback={fallback} />
    );

    // attempt 0 -> error
    fireEvent.error(container.querySelector('img'));
    act(() => { vi.advanceTimersByTime(600); });
    // attempt 1 -> error
    fireEvent.error(container.querySelector('img'));
    act(() => { vi.advanceTimersByTime(1200); });
    // attempt 2 (final) -> error
    fireEvent.error(container.querySelector('img'));

    expect(container.querySelector('img')).toBeNull();
    expect(queryByTestId('ph')).toBeTruthy();
  });

  it('calls onError when retries are exhausted', () => {
    const onError = vi.fn();
    const { container } = render(
      <RetryImg src="/thumbs/foo.png" alt="foo" maxRetries={1} onError={onError} />
    );
    fireEvent.error(container.querySelector('img'));
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.error(container.querySelector('img'));

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not call onError if a retry succeeds', () => {
    const onError = vi.fn();
    const { container } = render(
      <RetryImg src="/thumbs/foo.png" alt="foo" maxRetries={2} onError={onError} />
    );
    fireEvent.error(container.querySelector('img'));
    act(() => { vi.advanceTimersByTime(600); });

    // simulate the retried image loading successfully
    fireEvent.load(container.querySelector('img'));

    expect(onError).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeTruthy();
  });
});
