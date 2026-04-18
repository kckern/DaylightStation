import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NavProvider, useNav } from './NavProvider.jsx';

function Probe() {
  const { view, params, push, pop } = useNav();
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="params">{JSON.stringify(params)}</span>
      <button data-testid="to-detail" onClick={() => push('detail', { contentId: 'plex:1' })}>detail</button>
      <button data-testid="back" onClick={pop}>back</button>
    </div>
  );
}

describe('NavProvider', () => {
  it('defaults to view="home" with empty params', () => {
    render(<NavProvider><Probe /></NavProvider>);
    expect(screen.getByTestId('view')).toHaveTextContent('home');
    expect(screen.getByTestId('params')).toHaveTextContent('{}');
  });

  it('push changes view + params', () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => { screen.getByTestId('to-detail').click(); });
    expect(screen.getByTestId('view')).toHaveTextContent('detail');
    expect(screen.getByTestId('params')).toHaveTextContent('{"contentId":"plex:1"}');
  });

  it('pop returns to the previous view', () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => { screen.getByTestId('to-detail').click(); });
    act(() => { screen.getByTestId('back').click(); });
    expect(screen.getByTestId('view')).toHaveTextContent('home');
  });
});
