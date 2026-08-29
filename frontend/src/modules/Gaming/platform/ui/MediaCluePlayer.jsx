import React from 'react';
import './components.scss';

/**
 * Renders a media attachment (image/audio/video) from the media volume.
 * src in game sets is relative to media/apps/ (spec §5); served through the
 * party-games router's /media route (raw /media/* is not served by the app).
 */
export function MediaCluePlayer({ media, onError }) {
  if (!media?.type || !media?.src) return null;
  const url = `/api/v1/gaming/media/${media.src}`;
  const fail = () => onError?.(`media unavailable: ${media.src}`);
  if (media.type === 'image') return <img className="gp-media gp-media--image" src={url} alt="" onError={fail} />;
  if (media.type === 'audio') return <audio className="gp-media" src={url} autoPlay onError={fail} data-testid="media-audio" />;
  if (media.type === 'video') return <video className="gp-media gp-media--video" src={url} autoPlay onError={fail} data-testid="media-video" />;
  return null;
}
export default MediaCluePlayer;
