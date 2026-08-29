/** Projects semantic stream references into LAN-reachable playback URLs. */
export class MediaPlaybackUrlPresenter {
  constructor({ baseUrl }) {
    if (!baseUrl || typeof baseUrl !== 'string') throw new Error('MediaPlaybackUrlPresenter requires baseUrl');
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  present({ playable, stream }) {
    const supplied = playable?.mediaUrl;
    const relative = supplied ?? `/api/v1/stream/${stream.source}/${stream.id}`;
    if (/^https?:\/\//i.test(relative)) return relative;
    return `${this.baseUrl}${relative.startsWith('/') ? relative : `/${relative}`}`;
  }
}

export default MediaPlaybackUrlPresenter;
