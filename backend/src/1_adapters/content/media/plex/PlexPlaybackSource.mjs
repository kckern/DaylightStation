import { buildClientProfileExtra, canDirectPlayH264, canDirectStreamVideo, needsAudioDownmix, resolveTranscodeCaps } from './transcodeProfile.mjs';

const operations = { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported', findOwned: 'supported' };
const playableTypes = new Set(['movie', 'episode', 'clip', 'track']);

function sourceId(contentId) { return String(contentId || '').replace(/^plex:/, ''); }
function timeout(error) { return /timeout|ETIMEDOUT/i.test(String(error?.code || error?.message)); }
function failure(error) { return { kind: 'failed', reason: error?.name === 'AbortError' ? 'cancelled' : timeout(error) ? 'timeout' : 'provider' }; }
function trackSelection(tracks = {}) {
  return { audioId: tracks.audioId ?? null, subtitleId: tracks.subtitleId ?? null, subtitlesRequired: Boolean(tracks.subtitlesRequired) };
}

function firstMedia(item) { return Array.isArray(item?.Media) ? item.Media[0] : item?.Media; }
function stream(media, type, selectedId) {
  const streams = (Array.isArray(media?.Part) ? media.Part : [media?.Part]).flatMap(part => Array.isArray(part?.Stream) ? part.Stream : []);
  return streams.find(value => String(value?.id) === String(selectedId)) || streams.find(value => Number(value?.streamType) === type) || null;
}
function sourceRevision(item, id) {
  const media = firstMedia(item);
  return `plex:${id}:${item?.updatedAt ?? media?.id ?? 'unknown'}`;
}
function video(media, tracks) {
  const value = stream(media, 1);
  const codec = value?.codec || media?.videoCodec;
  if (!codec) return null;
  return { codec, profile: value?.profile ?? media?.videoProfile ?? null, level: value?.level ?? null, bitDepth: Number.isFinite(Number(value?.bitDepth)) ? Number(value.bitDepth) : null, width: Number(value?.width ?? media?.width) || null, height: Number(value?.height ?? media?.height) || null, frameRate: Number(value?.frameRate ?? media?.videoFrameRate) || null, hdr: value?.DOVIPresent || value?.colorTrc ? String(value.DOVIPresent ? 'dolby-vision' : value.colorTrc) : null };
}
function audio(media, tracks) {
  const value = stream(media, 2, tracks?.audioId);
  const codec = value?.codec || media?.audioCodec;
  if (!codec) return null;
  return { codec, channels: Number(value?.channels ?? media?.audioChannels) || null, layout: value?.audioChannelLayout ?? media?.audioChannelLayout ?? null, language: value?.language ?? null };
}
function subtitles(media) {
  const streams = (Array.isArray(media?.Part) ? media.Part : [media?.Part]).flatMap(part => Array.isArray(part?.Stream) ? part.Stream : []);
  return streams.filter(value => Number(value?.streamType) === 3 && value?.id != null && value?.codec && value?.language)
    .map(value => ({ id: String(value.id), language: String(value.language), format: String(value.codec) }));
}
function conversionFrom(decision) {
  const container = decision?.MediaContainer || decision?.container || decision;
  const transcodeCode = Number(container?.transcodeDecisionCode);
  const text = `${container?.generalDecisionText || ''} ${container?.transcodeDecisionText || ''}`.toLowerCase();
  if (transcodeCode === 1000 || text.includes('transcode')) return 'transcode';
  if (text.includes('direct stream') || text.includes('remux')) return 'remux';
  return null;
}
function decisionMedia(decision) {
  const container = decision?.MediaContainer || decision?.container || decision;
  const item = Array.isArray(container?.Video) ? container.Video[0] : container?.Video;
  const media = Array.isArray(item?.Media) ? item.Media[0] : item?.Media;
  const part = Array.isArray(media?.Part) ? media.Part[0] : media?.Part;
  return { container, media, part };
}

/** Plex anti-corruption adapter: raw Plex envelopes in, normalized playback facts out. */
export class PlexPlaybackSource {
  #provider;
  #proxyPath;
  #protocol;
  #platform;
  #token;
  #opened = new Map();

  constructor({ provider, proxyPath = null, protocol = null, platform = null, token = null } = {}) {
    if (!provider) throw new Error('PlexPlaybackSource requires provider');
    this.#provider = provider;
    this.#proxyPath = String(proxyPath ?? provider.proxyPath ?? '/api/v1/proxy/plex').replace(/\/$/, '');
    this.#protocol = protocol ?? provider.protocol ?? 'dash';
    this.#platform = platform ?? provider.platform ?? 'Chrome';
    this.#token = token ?? provider.token ?? '';
  }

  async #metadata(contentId, signal, deadline) {
    const id = sourceId(contentId);
    if (typeof this.#provider.metadata === 'function') return this.#provider.metadata({ contentId: id, signal, deadline });
    if (typeof this.#provider.getMetadata === 'function') return this.#provider.getMetadata(id, { signal, deadline });
    if (typeof this.#provider.client?.getMetadata === 'function') return this.#provider.client.getMetadata(id, { signal, deadline });
    throw new Error('Plex provider does not expose metadata');
  }

  async #decide(request) {
    if (typeof this.#provider.decide === 'function') return this.#provider.decide(request);
    if (typeof this.#provider.client?.request === 'function') {
      const item = request.item;
      const directPlay = canDirectPlayH264(item);
      const directStream = directPlay || canDirectStreamVideo(item);
      const caps = resolveTranscodeCaps({});
      const params = new URLSearchParams({
        path: `/library/metadata/${request.contentId}`, protocol: this.#protocol,
        'X-Plex-Client-Identifier': this.#session(request.attemptId || 'describe', request.generation || 0).clientIdentifier,
        'X-Plex-Session-Identifier': this.#session(request.attemptId || 'describe', request.generation || 0).sessionIdentifier,
        'X-Plex-Platform': this.#platform, autoAdjustQuality: '1', directPlay: directPlay ? '1' : '0', directStream: directStream ? '1' : '0',
        'X-Plex-Client-Profile-Extra': buildClientProfileExtra({ maxFrameRate: directStream ? null : caps.maxFrameRate, downmixAudio: needsAudioDownmix(item) }),
      });
      if (request.startOffset > 0) params.set('offset', String(Math.floor(request.startOffset)));
      if (!directStream) { params.set('maxVideoBitrate', String(caps.maxVideoBitrate)); params.set('maxVideoResolution', String(caps.maxResolution)); }
      if (this.#token) params.set('X-Plex-Token', this.#token);
      return this.#provider.client.request(`/video/:/transcode/universal/decision?${params}`, { signal: request.signal, deadline: request.deadline });
    }
    throw new Error('Plex provider does not expose a raw decision operation');
  }

  #candidate(item, id, tracks, decision = null) {
    const media = firstMedia(item);
    return {
      renditionId: `plex:${id}:original`, sourceRevision: sourceRevision(item, id), format: String(media?.container || 'dash'),
      video: video(media, tracks), audio: audio(media, tracks), subtitles: subtitles(media), trackSelection: trackSelection(tracks),
      conversion: conversionFrom(decision), ready: true, resourceClass: item?.type === 'track' ? 'audio' : 'video', estimatedUnits: conversionFrom(decision) === 'transcode' ? 1 : 0,
    };
  }

  async describe({ contentId, client, tracks, signal, deadline } = {}) {
    try {
      const id = sourceId(contentId);
      const response = await this.#metadata(id, signal, deadline);
      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item) return { kind: 'unavailable', reason: 'absent' };
      if (!playableTypes.has(item.type)) return { kind: 'unavailable', reason: 'non-playable-type' };
      // Plex's decision endpoint negotiates output but does not start a transcode.
      const decision = item.type === 'track' ? null : await this.#decide({ contentId: id, item, client, tracks, signal, deadline, startOffset: 0, start: false });
      return { kind: 'available', sourceRevision: sourceRevision(item, id), candidates: [this.#candidate(item, id, tracks, decision)], operations };
    } catch (error) { return failure(error); }
  }

  // The normal fast path negotiates once as it opens; it must never do a
  // preceding describe/probe/readiness pass.
  async openDefault(request) { return this.open(request); }

  #session(attemptId, generation) {
    const safe = String(attemptId || '').replace(/[^A-Za-z0-9._~-]+/g, '-').slice(0, 80) || 'unknown';
    return { clientIdentifier: `daylight-${safe}`, sessionIdentifier: `${safe}-${Number(generation) || 0}` };
  }

  #url({ id, item, decision, attemptId, generation, positionMs }) {
    const { container, part } = decisionMedia(decision);
    const actualConversion = conversionFrom(decision);
    const { clientIdentifier, sessionIdentifier } = this.#session(attemptId, generation);
    if (actualConversion === null && Number(container?.generalDecisionCode) === 2000 && part?.key) {
      const params = new URLSearchParams({ 'X-Plex-Client-Identifier': clientIdentifier, 'X-Plex-Session-Identifier': sessionIdentifier });
      if (this.#token) params.set('X-Plex-Token', this.#token);
      return `${this.#proxyPath}${part.key}${part.key.includes('?') ? '&' : '?'}${params}`;
    }
    const direct = canDirectPlayH264(item) || canDirectStreamVideo(item);
    const caps = resolveTranscodeCaps({});
    const params = new URLSearchParams({
      path: `/library/metadata/${id}`, protocol: this.#protocol, 'X-Plex-Client-Identifier': clientIdentifier,
      'X-Plex-Session-Identifier': sessionIdentifier, 'X-Plex-Platform': this.#platform, autoAdjustQuality: '1', fastSeek: '1',
      directPlay: canDirectPlayH264(item) ? '1' : '0', directStream: direct ? '1' : '0',
      'X-Plex-Client-Profile-Extra': buildClientProfileExtra({ maxFrameRate: direct ? null : caps.maxFrameRate, downmixAudio: needsAudioDownmix(item) }),
    });
    if (Number(positionMs) > 0) params.set('offset', String(Math.floor(Number(positionMs) / 1000)));
    if (!direct) { params.set('maxVideoBitrate', String(caps.maxVideoBitrate)); params.set('maxVideoResolution', String(caps.maxResolution)); }
    if (this.#token) params.set('X-Plex-Token', this.#token);
    return `${this.#proxyPath}/video/:/transcode/universal/start.mpd?${params}`;
  }

  async open({ contentId, renditionId, sourceRevision: expectedRevision, attemptId, generation, positionMs = 0, tracks, client, signal, deadline } = {}) {
    if (this.#opened.has(attemptId)) return { kind: 'failed', reason: 'attempt-already-open' };
    try {
      const id = sourceId(contentId);
      const response = await this.#metadata(id, signal, deadline);
      const item = response?.MediaContainer?.Metadata?.[0];
      if (!item) return { kind: 'failed', reason: 'absent' };
      if (expectedRevision != null && sourceRevision(item, id) !== expectedRevision) return { kind: 'failed', reason: 'source-revision-mismatch' };
      if (renditionId != null && renditionId !== `plex:${id}:original`) return { kind: 'failed', reason: 'unsupported-rendition' };
      const decision = item.type === 'track' ? null : await this.#decide({ contentId: id, item, client, tracks, signal, deadline, attemptId, generation, startOffset: Math.floor(Number(positionMs) / 1000), start: true });
      const actualRendition = this.#candidate(item, id, tracks, decision);
      const handle = `plex:${attemptId}`;
      const result = { kind: 'opened', handle, delivery: { format: item.type === 'track' ? 'audio' : 'dash', url: this.#url({ id, item, decision, attemptId, generation, positionMs }), contentOriginMs: Number(positionMs) || 0, seekWindow: null, expiresAt: null, segmentDurationMs: null }, actualRendition, conversion: actualRendition.conversion };
      this.#opened.set(attemptId, handle);
      return result;
    } catch (error) { return failure(error); }
  }

  async inspect({ attemptId, handle, signal, deadline } = {}) {
    if (typeof this.#provider.inspect !== 'function') return { kind: 'unsupported' };
    try {
      const result = await this.#provider.inspect({ attemptId, handle, signal, deadline });
      if (!result || typeof result.alive !== 'boolean') return { kind: 'unknown' };
      return { kind: 'observed', alive: result.alive, productionRate: Number.isFinite(result.productionRate) ? result.productionRate : null };
    } catch (error) { return failure(error); }
  }

  async renew({ attemptId, handle, signal, deadline } = {}) {
    if (typeof this.#provider.renew !== 'function') return { kind: 'unsupported' };
    try {
      const result = await this.#provider.renew({ attemptId, handle, signal, deadline });
      return result?.delivery ? { kind: 'renewed', delivery: result.delivery } : { kind: 'failed', reason: result?.reason || 'absent' };
    } catch (error) { return failure(error); }
  }

  async close({ attemptId, handle, signal, deadline } = {}) {
    if (!this.#opened.has(attemptId)) return { kind: 'unsupported' };
    if (typeof this.#provider.close !== 'function') { this.#opened.delete(attemptId); return { kind: 'unsupported' }; }
    try {
      const result = await this.#provider.close({ attemptId, handle, signal, deadline });
      if (result?.pending) return { kind: 'pending' };
      this.#opened.delete(attemptId);
      return { kind: 'closed' };
    } catch (error) { return failure(error); }
  }

  async findOwned({ attemptId } = {}) { return this.#opened.has(attemptId) ? { kind: 'found', handle: this.#opened.get(attemptId) } : { kind: 'absent' }; }
}

export default PlexPlaybackSource;
