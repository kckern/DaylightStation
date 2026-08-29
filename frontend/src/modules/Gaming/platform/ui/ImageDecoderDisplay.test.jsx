import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageDecoderDisplay, { generateDecoderArtifacts } from './ImageDecoderDisplay.jsx';

describe('ImageDecoderDisplay', () => {
  it('generates stable artifacts for a clue seed', () => {
    const first = generateDecoderArtifacts('monkey', 8);
    expect(generateDecoderArtifacts('monkey', 8)).toEqual(first);
    expect(generateDecoderArtifacts('different', 8)).not.toEqual(first);
    expect(first).toHaveLength(8);
    expect(first.some(({ kind }) => kind === 'ring')).toBe(true);
    expect(first.some(({ kind }) => kind === 'bubble')).toBe(true);
  });

  it('colors an SVG through a mask and overlays red artifacts', () => {
    const { container } = render(
      <ImageDecoderDisplay src="/api/v1/gaming/media/charades/monkey.svg" alt="Monkey clue" seed="monkey" artifactCount={12} />,
    );

    expect(screen.getByRole('img', { name: 'Monkey clue' })).toBeInTheDocument();
    expect(screen.getByTestId('image-decoder-subject').style.maskImage)
      .toContain('/api/v1/gaming/media/charades/monkey.svg');
    expect(container.querySelectorAll('.image-decoder-display__artifact')).toHaveLength(12);
  });
});
