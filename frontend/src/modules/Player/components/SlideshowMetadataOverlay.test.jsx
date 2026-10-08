import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlideshowMetadataOverlay } from './SlideshowMetadataOverlay.jsx';

describe('SlideshowMetadataOverlay', () => {
  it('renders the capture time in the timezone carried by the media', () => {
    render(
      <SlideshowMetadataOverlay
        mediaId="immich:korea-photo"
        visible={false}
        preloaded={{
          capturedAt: '2018-10-08T07:30:33.095Z',
          localDateTime: '2018-10-08T16:30:33.095Z',
          captureTimeZone: 'Asia/Seoul',
          people: [],
          location: 'Seoul, South Korea',
        }}
      />
    );

    expect(screen.getByText(/Monday, October 8, 2018 at 4:30 PM/i)).toBeInTheDocument();
    expect(screen.queryByText(/KST/i)).not.toBeInTheDocument();
  });

  it('preserves an offset-based Immich wall clock instead of converting in the player zone', () => {
    render(
      <SlideshowMetadataOverlay
        mediaId="immich:lunch-photo"
        visible={false}
        preloaded={{
          capturedAt: '2025-10-08T16:00:00.000Z',
          localDateTime: '2025-10-08T12:00:00.000Z',
          captureTimeZone: 'UTC-4',
          people: [],
          location: 'New York',
        }}
      />
    );

    expect(screen.getByText(/Wednesday, October 8, 2025 at 12:00 PM/i)).toBeInTheDocument();
    expect(screen.queryByText(/UTC-4/i)).not.toBeInTheDocument();
  });

  it('uses the exact same overlay treatment for videos as photos', () => {
    const { container } = render(
      <SlideshowMetadataOverlay
        mediaId="immich:korea-video"
        visible={false}
        variant="video"
        preloaded={{
          // Imported videos can retain only their recovered local wall clock.
          capturedAt: null,
          localDateTime: '2018-10-08T16:30:33.095Z',
          captureTimeZone: 'Asia/Seoul',
          people: [],
          location: 'Seoul, South Korea',
        }}
      />
    );

    expect(screen.getByText(/Monday, October 8, 2018 at 4:30 PM/i)).toBeInTheDocument();
    expect(screen.getByText('8 years ago')).toBeInTheDocument();
    expect(screen.queryByText(/KST/i)).not.toBeInTheDocument();
    expect(container.querySelector('.slideshow-metadata')).toHaveClass('slideshow-metadata');
    expect(container.querySelector('.slideshow-metadata')).not.toHaveClass('slideshow-metadata--video');
  });
});
