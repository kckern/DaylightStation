import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

let subscriber;
vi.mock('@/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, callback) => { subscriber = callback; },
}));

import EffectOverlay from './EffectOverlay.jsx';

describe('EffectOverlay', () => {
  it('renders an advisory judgment reason without treating it as an outcome', async () => {
    render(<EffectOverlay sessionId="session:1" />);
    act(() => subscriber({ kind: 'effect', sessionId: 'session:1', effect: { type: 'ai.judgment-proposal', proposal: { advisory: true, recommendation: 'confirm', reason: 'The answer matches.' } } }));
    expect(await screen.findByText('confirm — The answer matches.')).toBeTruthy();
    expect(screen.getByText('Review suggestion')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss message' })).toBeTruthy();
  });
});
