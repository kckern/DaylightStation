import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Composers } from './Composers.jsx';

describe('Composers placeholder mode', () => {
  it('renders the heading and the coming-soon placeholder', () => {
    render(<Composers />);
    expect(screen.getByRole('heading', { name: 'Composers' })).toBeTruthy();
    expect(screen.getByText(/Coming soon — an educational reference/)).toBeTruthy();
  });
});
