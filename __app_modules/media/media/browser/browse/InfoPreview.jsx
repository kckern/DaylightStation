// browse/InfoPreview.jsx
// A look at the film inside its own art, on this device — never a play.
//
// Where the picture comes from (recon 2026-11-26, Task 5 of search-to-screen):
// the info view already holds the item's `mediaUrl` (`api/v1/info/...` passes
// it through from the adapter's PlayableItem). For a Plex video that the
// adapter judged direct-playable it is the original file through the plain
// Plex passthrough (`/api/v1/proxy/plex/library/parts/...`, `mediaType:
// 'video'`): a progressive download with range requests — no transcode
// session, no client session, nothing recorded. Every other playback source
// is ruled out:
//   - `GET api/v1/play/:id` runs ProgressSyncService.reconcileOnPlay (it writes
//     a session bookmark and syncs progress) and its URL carries a Plex session;
//   - `/api/v1/proxy/plex/stream/:ratingKey` (what a non-direct video names)
//     mints a Plex transcode that would run for nobody once the preview stops;
//   - HLS / DASH manifests (`hls_video`, `dash_video`, .m3u8, .mpd) are the same
//     transcodes by another name, and need a player this page does not mount.
// So a preview exists only for `mediaType: 'video'` with a progressive URL
// (see `previewSource`); anything else gets no Preview control at all. There
// is no trailer/extras source on the info payload to prefer.
//
// What it never does: go through the session controller, the Player, dispatch,
// `play/log` or a progress save; wake or command a screen; touch resume,
// watched, Carry on, Recent or habits. It is a bare muted <video> the page owns.
//
// It starts only on a press of its own control (never on open, focus or
// hover), plays muted, and carries a "Preview" label on the art. Its control is
// a default (grey) button with an eye glyph: amber and ▶ belong to PLAY. The
// parent stops it through the ref (`stop()`) before PLAY dispatches; unmount
// (Back) stops it too. Stopping pauses, removes `src` and calls load(), which
// aborts the download.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Image, UnstyledButton } from '@mantine/core';
import { IconEye, IconPlayerStop, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { itemKind } from "../habits/mediaHabits.js";
import mediaLog from "../logging/mediaLog.js";

const STREAMED = /\.(m3u8|mpd)(\?|$)|\/proxy\/plex\/stream\//i;

/** The progressive URL a preview may play for `item`, or null (no preview). */
export function previewSource(item) {
  if (!item || itemKind(item) !== 'video') return null;
  if (String(item.mediaType ?? '').toLowerCase() !== 'video') return null;
  const url = item.mediaUrl;
  if (typeof url !== 'string' || !url || STREAMED.test(url)) return null;
  return url;
}

function release(video) {
  if (!video) return;
  try { video.pause(); } catch { /* already gone */ }
  video.removeAttribute('src');
  try { video.load(); } catch { /* aborts the download where supported */ }
}

export const InfoPreview = forwardRef(function InfoPreview({ item, onStart, onStop }, ref) {
  const src = previewSource(item);
  const contentId = item?.contentId ?? item?.id ?? null;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  // Kept past React's ref detach so an unmount can still release the file.
  const videoRef = useRef(null);
  const keepVideo = useCallback((el) => { if (el) videoRef.current = el; }, []);
  const liveRef = useRef(null); // { contentId } while a preview is on
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const stop = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    const video = videoRef.current;
    videoRef.current = null;
    const seconds = Math.round(Number(video?.currentTime) || 0);
    release(video);
    setPlaying(false);
    mediaLog.previewStopped({ contentId: live.contentId, seconds });
    onStopRef.current?.();
  }, []);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  // Unmount (Back) or a different item stops it.
  useEffect(() => stop, [stop, contentId]);

  // Start once the <video> exists: muted, on this device only.
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const started = video.play?.();
    if (started && typeof started.catch === 'function') started.catch(() => {});
  }, [playing]);

  if (!src) {
    return item?.thumbnail ? <Image src={item.thumbnail} alt="" className="detail-poster" radius="md" /> : null;
  }

  const start = () => {
    if (liveRef.current) return;
    liveRef.current = { contentId };
    setMuted(true);
    setPlaying(true);
    mediaLog.previewStarted({ contentId, seconds: 0 });
    onStart?.();
  };

  return (
    <div className="detail-preview">
      {(item.thumbnail || playing) && (
        <div className="detail-poster-box" data-previewing={playing || undefined}>
          {playing ? (
            <>
              <video
                ref={keepVideo}
                className="detail-preview-video"
                src={src}
                muted={muted}
                playsInline
                disableRemotePlayback
                preload="auto"
                poster={item.thumbnail || undefined}
              />
              <span className="detail-preview-label" data-testid="detail-preview-label">Preview</span>
              <UnstyledButton
                className="detail-preview-sound"
                data-testid="detail-preview-sound"
                aria-label={muted ? 'Sound on' : 'Sound off'}
                aria-pressed={!muted}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
              </UnstyledButton>
            </>
          ) : (
            <Image src={item.thumbnail} alt="" className="detail-poster" radius="md" />
          )}
        </div>
      )}
      <Button
        data-testid="detail-preview"
        className="detail-preview-toggle"
        variant="default"
        size="xs"
        aria-pressed={playing}
        leftSection={playing ? <IconPlayerStop size={14} /> : <IconEye size={14} />}
        onClick={playing ? stop : start}
      >
        {playing ? 'Stop preview' : 'Preview'}
      </Button>
    </div>
  );
});

export default InfoPreview;
