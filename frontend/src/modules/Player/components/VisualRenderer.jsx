import React from 'react';
import PropTypes from 'prop-types';

// App visual components
import { BlackoutScreen } from './visuals/BlackoutScreen.jsx';
import { Screensaver } from './visuals/Screensaver.jsx';
import { ClockDisplay } from './visuals/ClockDisplay.jsx';

// Media components - VideoPlayer is existing, ImageCarousel is stubbed
import { VideoPlayer } from './VideoPlayer.jsx';

/**
 * ImageCarousel - Stub component for image/pages media type
 * Renders a single image from the items array.
 * Full implementation in Task #16.
 */
function ImageCarousel({ items, currentIndex = 0, loop, onAdvance }) {
  const item = items?.[currentIndex] || items?.[0];

  if (!item) {
    return (
      <div
        data-track="visual"
        data-visual-type="image"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff'
        }}
      >
        No images available
      </div>
    );
  }

  return (
    <div
      data-track="visual"
      data-visual-type="image"
      data-image-index={currentIndex}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <img
        src={item.url}
        alt={item.caption || `Image ${currentIndex + 1}`}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain'
        }}
      />
    </div>
  );
}

ImageCarousel.propTypes = {
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    url: PropTypes.string.isRequired,
    duration: PropTypes.number,
    caption: PropTypes.string
  })),
  currentIndex: PropTypes.number,
  loop: PropTypes.bool,
  onAdvance: PropTypes.func
};

/**
 * ArtFrame - Stub component for single static image display
 * Future: frame styling, mat effects, museum mode
 */
function ArtFrame({ config = {} }) {
  const { imageUrl, title, artist } = config;

  return (
    <div
      data-track="visual"
      data-visual-type="art-frame"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title || 'Art'}
          style={{
            maxWidth: '90%',
            maxHeight: '90%',
            objectFit: 'contain'
          }}
        />
      ) : (
        <div style={{ color: 'rgba(255, 255, 255, 0.5)' }}>
          Art Frame (no image configured)
        </div>
      )}
    </div>
  );
}

ArtFrame.propTypes = {
  config: PropTypes.shape({
    imageUrl: PropTypes.string,
    title: PropTypes.string,
    artist: PropTypes.string
  })
};

/**
 * App component registry
 * Maps app identifiers to their component implementations
 */
const APP_COMPONENTS = {
  'blackout': BlackoutScreen,
  'screensaver': Screensaver,
  'clock': ClockDisplay,
  'art-frame': ArtFrame
};

/**
 * Media component registry
 * Maps media types to their component implementations
 */
const MEDIA_COMPONENTS = {
  'image': ImageCarousel,
  'pages': ImageCarousel,
  'video': VideoPlayer
};

/**
 * VisualRenderer - Polymorphic visual renderer for composed presentations
 *
 * Renders either:
 * - App components (blackout, screensaver, clock, art-frame) for category 'app'
 * - Media components (image carousel, video player) for category 'media'
 *
 * @param {Object} track - Visual track configuration from IVisualTrack interface
 * @param {Object} audioState - Current audio playback state for synced advances
 * @param {Function} onAdvance - Callback when visual should advance to next item
 */
export function VisualRenderer({ track, audioState, onAdvance }) {
  if (!track) {
    return (
      <div data-track="visual" data-visual-type="empty">
        No visual track configured
      </div>
    );
  }

  // App category - frontend-rendered UI components
  if (track.category === 'app') {
    const AppComponent = APP_COMPONENTS[track.app];

    if (!AppComponent) {
      console.warn(`[VisualRenderer] Unknown app type: ${track.app}`);
      return (
        <div
          data-track="visual"
          data-visual-type={track.app}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          Unknown app: {track.app}
        </div>
      );
    }

    return <AppComponent config={track.appConfig} />;
  }

  // Media category - content from backend adapters
  if (track.category === 'media') {
    const MediaComponent = MEDIA_COMPONENTS[track.type];

    if (!MediaComponent) {
      console.warn(`[VisualRenderer] Unknown media type: ${track.type}`);
      return (
        <div
          data-track="visual"
          data-visual-type={track.type}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#000',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          Unknown media type: {track.type}
        </div>
      );
    }

    // For video type, adapt to VideoPlayer's expected props
    if (track.type === 'video') {
      // VideoPlayer expects media object with media_url, etc.
      const videoItem = track.items?.[0];
      if (!videoItem) {
        return (
          <div
            data-track="visual"
            data-visual-type="video"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: '#000',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            No video source available
          </div>
        );
      }

      // Build media object expected by VideoPlayer
      const media = {
        media_url: videoItem.url,
        media_type: videoItem.mediaType || 'video',
        title: videoItem.caption || videoItem.title,
        ...videoItem
      };

      return (
        <div data-track="visual" data-visual-type="video">
          <VideoPlayer
            media={media}
            advance={onAdvance || (() => {})}
            clear={() => {}}
          />
        </div>
      );
    }

    // For image/pages types, use ImageCarousel
    return (
      <MediaComponent
        items={track.items}
        loop={track.loop}
        onAdvance={onAdvance}
      />
    );
  }

  // Unknown category
  console.warn(`[VisualRenderer] Unknown category: ${track.category}`);
  return (
    <div
      data-track="visual"
      data-visual-type="unknown"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      Unknown category: {track.category}
    </div>
  );
}

VisualRenderer.propTypes = {
  track: PropTypes.shape({
    category: PropTypes.oneOf(['media', 'app']).isRequired,

    // For media category
    type: PropTypes.oneOf(['image', 'video', 'pages']),
    items: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string,
      url: PropTypes.string.isRequired,
      duration: PropTypes.number,
      caption: PropTypes.string
    })),

    // For app category
    app: PropTypes.oneOf(['blackout', 'screensaver', 'clock', 'art-frame']),
    appConfig: PropTypes.object,

    // Advance configuration
    advance: PropTypes.shape({
      mode: PropTypes.oneOf(['none', 'timed', 'onTrackEnd', 'manual', 'synced']),
      interval: PropTypes.number,
      markers: PropTypes.arrayOf(PropTypes.shape({
        time: PropTypes.number.isRequired,
        index: PropTypes.number.isRequired
      }))
    }),

    loop: PropTypes.bool
  }),
  audioState: PropTypes.shape({
    currentTime: PropTypes.number,
    trackEnded: PropTypes.bool,
    isPaused: PropTypes.bool
  }),
  onAdvance: PropTypes.func
};

// Named exports for individual components
export { BlackoutScreen } from './visuals/BlackoutScreen.jsx';
export { Screensaver } from './visuals/Screensaver.jsx';
export { ClockDisplay } from './visuals/ClockDisplay.jsx';
export { ImageCarousel, ArtFrame };

export default VisualRenderer;
