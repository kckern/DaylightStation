import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SafeImg from './SafeImg.jsx';

describe('SafeImg', () => {
  it('renders the image until it errors, then the fallback copy', () => {
    render(<SafeImg src="/nope.png" alt="A worksheet" fallback="Preview not available" />);
    const img = screen.getByAltText('A worksheet');
    fireEvent.error(img);
    expect(screen.queryByAltText('A worksheet')).toBeNull();
    expect(screen.getByText('Preview not available')).toBeTruthy();
  });
});
