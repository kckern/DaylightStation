import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageDecoderDisplay from './ImageDecoderDisplay.jsx';
import { generateDecoderArtifacts } from './imageDecoderArtifacts.js';

describe('ImageDecoderDisplay', () => {
  afterEach(() => vi.useRealTimers());
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

  it('repositions and rescales only the concealed subject every configured interval', () => {
    vi.useFakeTimers();
    const { container } = render(<ImageDecoderDisplay src="/clue.svg" seed="moving" motionIntervalMs={1000} />);
    const subject = screen.getByTestId('image-decoder-subject');
    const artifacts = container.querySelector('.image-decoder-display__artifacts');
    const first = subject.style.transform;
    act(() => vi.advanceTimersByTime(1000));
    expect(subject.style.transform).not.toBe(first);
    expect(artifacts).not.toHaveAttribute('style');
    const second = subject.style.transform;
    act(() => vi.advanceTimersByTime(1000));
    expect(subject.style.transform).not.toBe(second);
  });
});

it('reports image failure without an answer label and supports retry', async () => {
 const {fireEvent}=await import('@testing-library/react');
 const {container}=render(<ImageDecoderDisplay src="/missing.svg" />);
 fireEvent.error(container.querySelector('img'));
 expect(screen.getByRole('alert')).toHaveTextContent('Clue image could not load');
 fireEvent.click(screen.getByRole('button',{name:'Retry image'}));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByTestId('image-decoder-subject').style.maskImage).toContain('decoder_retry=1');
 expect(container.querySelector('img').getAttribute('src')).toContain('decoder_retry=1');
});

it('covers the full image field with texture and crossing streaks, including between rings', () => {
 const {container}=render(<ImageDecoderDisplay src="/clue.svg" seed="texture"/>);
 expect(container.querySelectorAll('.image-decoder-display__texture-tile')).toHaveLength(625);
 expect(container.querySelectorAll('.image-decoder-display__streak')).toHaveLength(40);
});
