import React from 'react';
import { render, screen } from '@testing-library/react';
import { DecoderText } from './DecoderPresenter.jsx';

describe('DecoderText', () => {
  it('describes the encoded clue without exposing its words to assistive technology', () => {
    render(<DecoderText>Secret banana</DecoderText>);

    const encodedClue = screen.getByRole('img', { name: 'Encoded clue for the performer' });
    expect(encodedClue).toBeInTheDocument();
    expect(encodedClue).not.toHaveAccessibleName(/secret banana/i);
    expect(screen.queryByText('Secret banana')).not.toBeInTheDocument();
  });
});
