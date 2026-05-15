import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchIdleState } from './SearchIdleState.jsx';
import { SearchEmptyState } from './SearchEmptyState.jsx';
import { SearchErrorState } from './SearchErrorState.jsx';

describe('SearchIdleState', () => {
  test('shows the start-typing prompt when no input', () => {
    render(<SearchIdleState input="" />);
    expect(screen.getByTestId('search-idle-prompt')).toBeInTheDocument();
  });
  test('shows deep-link affordance when input looks like a content ID', () => {
    const onAction = vi.fn();
    render(<SearchIdleState input="plex-main:42" onDeepLink={onAction} />);
    const btn = screen.getByTestId('search-deeplink-play');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith({ source: 'plex-main', localId: '42' });
  });
  test('does not show deep-link when input is free-text', () => {
    render(<SearchIdleState input="hello world" />);
    expect(screen.queryByTestId('search-deeplink-play')).not.toBeInTheDocument();
  });
});

describe('SearchEmptyState', () => {
  test('echoes the query and shows zero-results message', () => {
    render(<SearchEmptyState query="nonsense" />);
    expect(screen.getByTestId('search-empty')).toHaveTextContent('nonsense');
  });
});

describe('SearchErrorState', () => {
  test('renders the error message and a retry button', () => {
    const onRetry = vi.fn();
    render(<SearchErrorState error={{ kind: 'connection', message: 'lost it' }} onRetry={onRetry} />);
    expect(screen.getByTestId('search-error')).toHaveTextContent('lost it');
    fireEvent.click(screen.getByTestId('search-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
