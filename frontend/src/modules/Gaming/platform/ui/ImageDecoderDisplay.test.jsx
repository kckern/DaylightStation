import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageDecoderDisplay from './ImageDecoderDisplay.jsx';
import { generateDecoderArtifacts, generateDecoderMotion } from './imageDecoderArtifacts.js';

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

  it('moves the full decoder card while its clue and interference stay full-card and locked together', () => {
    vi.useFakeTimers();
    const { container } = render(<ImageDecoderDisplay src="/clue.svg" seed="moving" motionIntervalMs={1000} />);
    const card = container.querySelector('.image-decoder-display');
    const subject = screen.getByTestId('image-decoder-subject');
    const artifacts = container.querySelector('.image-decoder-display__artifacts');
    const composite = screen.getByTestId('image-decoder-composite');
    expect(composite).toContainElement(subject);
    expect(composite).toContainElement(artifacts);
    expect(composite).not.toHaveAttribute('style');
    expect(subject.style.transform).toBe('');
    expect(artifacts.style.transform).toBe('rotate(0deg)');
    const first = card.style.transform;
    act(() => vi.advanceTimersByTime(1000));
    expect(card.style.transform).not.toBe(first);
    expect(artifacts.style.transform).toBe('rotate(90deg)');
    const second = card.style.transform;
    act(() => vi.advanceTimersByTime(1000));
    expect(card.style.transform).not.toBe(second);
    expect(artifacts.style.transform).toBe('rotate(180deg)');

    const frames = generateDecoderMotion('moving');
    for (let index = 1; index < frames.length; index += 1) {
      const distance = Math.hypot(frames[index].x - frames[index - 1].x, frames[index].y - frames[index - 1].y);
      expect(distance / 100).toBeGreaterThanOrEqual(0.5);
    }
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
