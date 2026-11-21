import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchEmptyState } from "./SearchEmptyState.jsx";

describe('SearchEmptyState', () => {
  it('names the query and suggests a different word when no results match', () => {
    render(<SearchEmptyState query="bluey" />);

    const el = screen.getByTestId('search-empty');
    expect(el).toHaveTextContent('No results for “bluey”. Try a different word.');
    expect(screen.getByRole('status')).toHaveTextContent('No results for “bluey”. Try a different word.');
    expect(screen.queryByTestId('search-empty-retry')).toBeNull();
  });

  it('source-error state: some libraries failed — offers retry when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(
      <SearchEmptyState
        query="bluey"
        sourceErrors={[{ source: 'plex', error: 'timeout' }]}
        onRetry={onRetry}
      />
    );

    const el = screen.getByTestId('search-empty');
    expect(el).toHaveTextContent('Some libraries didn’t respond, so “bluey” may have been missed.');
    expect(screen.getByRole('status')).toHaveTextContent('Some libraries didn’t respond, so “bluey” may have been missed.');
    expect(screen.getByRole('status').querySelector('button')).toBeNull();
    fireEvent.click(screen.getByTestId('search-empty-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('source-error state: omits the retry button when onRetry is not a function', () => {
    render(<SearchEmptyState query="bluey" sourceErrors={[{ source: 'plex', error: 'timeout' }]} />);
    expect(screen.queryByTestId('search-empty-retry')).toBeNull();
  });
});
