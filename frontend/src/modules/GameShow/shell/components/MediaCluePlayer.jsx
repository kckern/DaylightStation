import React from 'react';
import './components.scss';

/**
 * Renders a media attachment (image/audio/video) from the media volume.
 * src in game sets is relative to media/apps/ (spec §5); served through the
 * gameshow router's /media route (raw /media/* is not served by the app).
 */
export function MediaCluePlayer({ media, onError }) {
  if (!media?.type || !media?.src) return null;
  const url = `/api/v1/gameshow/media/${media.src}`;
  const fail = () => onError?.(`media unavailable: ${media.src}`);
  if (media.type === 'image') return <img className="gs-media gs-media--image" src={url} alt="" onError={fail} />;
  if (media.type === 'audio') return <audio className="gs-media" src={url} autoPlay onError={fail} data-testid="media-audio" />;
  if (media.type === 'video') return <video className="gs-media gs-media--video" src={url} autoPlay onError={fail} data-testid="media-video" />;
  return null;
}
export default MediaCluePlayer;
