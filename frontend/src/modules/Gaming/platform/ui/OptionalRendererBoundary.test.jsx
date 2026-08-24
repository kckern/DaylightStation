import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OptionalRendererBoundary } from './OptionalRendererBoundary.jsx';

function Broken() { throw new Error('visual failure'); }
describe('OptionalRendererBoundary', () => {
  it('contains visual failures and renders deterministic fallback', () => { const failure = vi.fn(); render(<OptionalRendererBoundary rendererId="scene" fallback={<div>State-safe fallback</div>} onFailure={failure}><Broken /></OptionalRendererBoundary>); expect(screen.getByText('State-safe fallback')).toBeTruthy(); expect(failure).toHaveBeenCalledOnce(); });
});
