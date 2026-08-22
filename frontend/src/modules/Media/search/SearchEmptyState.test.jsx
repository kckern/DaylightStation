// SearchEmptyState.test.jsx — covers the existing source-error / plain-empty
// branches plus the D5 widened-scope branch added in Task 11's fix round
// (fellBackToAll / scopeLabel / resultCount).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchEmptyState } from './SearchEmptyState.jsx';

describe('SearchEmptyState', () => {
  it('plain empty state: no source errors, no fallback — names the query and suggests changing scope', () => {
    render(<SearchEmptyState query="bluey" />);

    const el = screen.getByTestId('search-empty');
    expect(el).toHaveTextContent('No results for “bluey”. Try a different word or change the scope.');
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
    fireEvent.click(screen.getByTestId('search-empty-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('source-error state: omits the retry button when onRetry is not a function', () => {
    render(<SearchEmptyState query="bluey" sourceErrors={[{ source: 'plex', error: 'timeout' }]} />);
    expect(screen.queryByTestId('search-empty-retry')).toBeNull();
  });

  // ── D5 (Task 11 fix round): scoped-empty fallback to All ──

  it('D5: fellBackToAll with results names the scope and the result count', () => {
    render(
      <SearchEmptyState query="bluey" fellBackToAll resultCount={3} scopeLabel="Ambient" />
    );

    expect(screen.getByTestId('search-empty'))
      .toHaveTextContent('Nothing in Ambient — showing 3 results from everywhere.');
  });

  it('D5: fellBackToAll singular result count uses "result", not "results"', () => {
    render(
      <SearchEmptyState query="bluey" fellBackToAll resultCount={1} scopeLabel="Ambient" />
    );

    expect(screen.getByTestId('search-empty'))
      .toHaveTextContent('Nothing in Ambient — showing 1 result from everywhere.');
  });

  it('D5: fellBackToAll without a scopeLabel falls back to generic "this scope" wording', () => {
    render(<SearchEmptyState query="bluey" fellBackToAll resultCount={2} />);

    expect(screen.getByTestId('search-empty'))
      .toHaveTextContent('Nothing in this scope — showing 2 results from everywhere.');
  });

  it('D5: fellBackToAll with resultCount 0 (even All is empty) falls through to the plain empty copy, not the widened banner', () => {
    render(<SearchEmptyState query="zzzznomatch" fellBackToAll resultCount={0} scopeLabel="Ambient" />);

    const el = screen.getByTestId('search-empty');
    expect(el).toHaveTextContent('No results for “zzzznomatch”. Try a different word or change the scope.');
    expect(el).not.toHaveTextContent('Ambient');
  });

  it('D5: fellBackToAll=false (default) ignores resultCount/scopeLabel entirely, even if passed', () => {
    render(<SearchEmptyState query="bluey" resultCount={5} scopeLabel="Ambient" />);

    const el = screen.getByTestId('search-empty');
    expect(el).toHaveTextContent('No results for “bluey”');
    expect(el).not.toHaveTextContent('Ambient');
  });
});
