// frontend/src/modules/Player/lib/engineTracks.js
//
// Subtitles and audio language for streams that carry their own tracks
// (RQ-STEER-14) — anything that is not a Plex transcode, whose tracks come
// from Plex's stream metadata instead (shared/contracts/media/playerFeatures.mjs).
//
// One small adapter per playback engine, all with the same shape:
//   list()                → { source, audio: Track[], subtitles: Track[], selected: { audio, subtitle } } | null
//   select({ audio, subtitle })  → true when something was applied
// Track: { id, language, label }. A subtitle choice of "off" hides them all.
//
//   native  <video>.audioTracks (where the browser has it) and .textTracks
//   hls     hls.js audioTracks / subtitleTracks (+ subtitleDisplay)
//   dash    dash.js getTracksFor('audio'|'text'), setCurrentTrack, setTextTrack

const OFF = 'off';
const TEXT_KINDS = new Set(['subtitles', 'captions']);

const languageOf = (value) => (typeof value === 'string' && value ? value : null);
const labelOf = (...candidates) => candidates.find((c) => typeof c === 'string' && c) ?? 'Unknown';
const toList = (listLike) => {
  if (!listLike) return [];
  if (Array.isArray(listLike)) return listLike;
  const out = [];
  for (let i = 0; i < (listLike.length ?? 0); i += 1) out.push(listLike[i]);
  return out;
};

function result(source, audio, subtitles, selected) {
  if (audio.length === 0 && subtitles.length === 0) return null;
  return { source, audio, subtitles, selected };
}

export function nativeTrackEngine(el) {
  const textTracks = () => toList(el?.textTracks).filter((t) => TEXT_KINDS.has(t.kind));
  const audioTracks = () => toList(el?.audioTracks);
  return {
    kind: 'native',
    list() {
      if (!el) return null;
      const audio = audioTracks().map((t, i) => ({ id: String(t.id || i), language: languageOf(t.language), label: labelOf(t.label, t.language) }));
      const subs = textTracks();
      const subtitles = subs.map((t, i) => ({ id: String(t.id || i), language: languageOf(t.language), label: labelOf(t.label, t.language) }));
      const enabledAudio = audioTracks().findIndex((t) => t.enabled);
      const showing = subs.findIndex((t) => t.mode === 'showing');
      return result('native', audio, subtitles, {
        audio: enabledAudio >= 0 ? audio[enabledAudio].id : audio[0]?.id ?? null,
        subtitle: showing >= 0 ? subtitles[showing].id : null,
      });
    },
    select({ audio, subtitle } = {}) {
      let applied = false;
      if (audio != null) {
        const tracks = audioTracks();
        const index = tracks.findIndex((t, i) => String(t.id || i) === audio);
        if (index >= 0) { tracks.forEach((t, i) => { t.enabled = i === index; }); applied = true; }
      }
      if (subtitle != null) {
        const subs = textTracks();
        const index = subtitle === OFF ? -1 : subs.findIndex((t, i) => String(t.id || i) === subtitle);
        if (subtitle === OFF || index >= 0) {
          subs.forEach((t, i) => { t.mode = i === index ? 'showing' : 'disabled'; });
          applied = true;
        }
      }
      return applied;
    },
  };
}

export function hlsTrackEngine(hls) {
  return {
    kind: 'hls',
    list() {
      if (!hls) return null;
      const audio = toList(hls.audioTracks).map((t, i) => ({ id: String(i), language: languageOf(t.lang), label: labelOf(t.name, t.lang) }));
      const subtitles = toList(hls.subtitleTracks).map((t, i) => ({ id: String(i), language: languageOf(t.lang), label: labelOf(t.name, t.lang) }));
      const subIndex = Number.isInteger(hls.subtitleTrack) && hls.subtitleTrack >= 0 && hls.subtitleDisplay !== false ? hls.subtitleTrack : -1;
      return result('hls', audio, subtitles, {
        audio: Number.isInteger(hls.audioTrack) && hls.audioTrack >= 0 ? String(hls.audioTrack) : audio[0]?.id ?? null,
        subtitle: subIndex >= 0 ? String(subIndex) : null,
      });
    },
    select({ audio, subtitle } = {}) {
      let applied = false;
      if (audio != null && Number(audio) < toList(hls?.audioTracks).length) { hls.audioTrack = Number(audio); applied = true; }
      if (subtitle === OFF) { hls.subtitleTrack = -1; applied = true; }
      else if (subtitle != null && Number(subtitle) < toList(hls?.subtitleTracks).length) {
        hls.subtitleDisplay = true;
        hls.subtitleTrack = Number(subtitle);
        applied = true;
      }
      return applied;
    },
  };
}

export function dashTrackEngine(api) {
  const tracks = (type) => {
    try { return toList(api?.getTracksFor?.(type)); } catch { return []; }
  };
  const describe = (t, i) => ({
    id: String(t.id ?? t.index ?? i),
    language: languageOf(t.lang),
    label: labelOf(t.labels?.[0]?.text, t.labels?.[0], t.lang),
  });
  return {
    kind: 'dash',
    list() {
      if (!api) return null;
      const audioInfos = tracks('audio');
      const textInfos = tracks('text');
      const audio = audioInfos.map(describe);
      const subtitles = textInfos.map(describe);
      let current = null;
      try { current = api.getCurrentTrackFor?.('audio') ?? null; } catch { current = null; }
      const audioIndex = current ? audioInfos.indexOf(current) : -1;
      let textIndex = -1;
      try { textIndex = api.getCurrentTextTrackIndex?.() ?? -1; } catch { textIndex = -1; }
      return result('dash', audio, subtitles, {
        audio: audioIndex >= 0 ? audio[audioIndex].id : audio[0]?.id ?? null,
        subtitle: textIndex >= 0 && subtitles[textIndex] ? subtitles[textIndex].id : null,
      });
    },
    select({ audio, subtitle } = {}) {
      let applied = false;
      if (audio != null) {
        const infos = tracks('audio');
        const index = infos.map(describe).findIndex((t) => t.id === audio);
        if (index >= 0) { api.setCurrentTrack(infos[index]); applied = true; }
      }
      if (subtitle === OFF) { api.setTextTrack?.(-1); applied = true; }
      else if (subtitle != null) {
        const index = tracks('text').map(describe).findIndex((t) => t.id === subtitle);
        if (index >= 0) { api.enableText?.(true); api.setTextTrack?.(index); applied = true; }
      }
      return applied;
    },
  };
}

/** Build the adapter for whatever a renderer reports: { kind, el|hls|api }. */
export function trackEngineFor(handle) {
  if (!handle) return null;
  if (handle.kind === 'hls' && handle.hls) return hlsTrackEngine(handle.hls);
  if (handle.kind === 'dash' && handle.api) return dashTrackEngine(handle.api);
  if (handle.el) return nativeTrackEngine(handle.el);
  return null;
}
