import { useEffect, useRef, useState } from 'react';

export function useMediaHealth(peer, enabled, videoElementRef) {
  const [health, setHealth] = useState({ audio: false, video: false, verified: false });
  const previousRef = useRef({ audio: 0, video: 0, frames: 0 });
  const peerRef = useRef(peer);
  peerRef.current = peer;

  useEffect(() => {
    if (!enabled) { setHealth({ audio: false, video: false, verified: false }); return undefined; }
    let cancelled = false;
    const startedAt = Date.now();
    const check = async () => {
      const currentPeer = peerRef.current;
      const pc = currentPeer.pcRef.current;
      if (!pc) return;
      const totals = { audio: 0, video: 0 };
      const stats = await pc.getStats();
      stats.forEach(report => {
        if (report.type !== 'inbound-rtp' || report.isRemote) return;
        const kind = report.kind || report.mediaType;
        if (kind === 'audio' || kind === 'video') totals[kind] += Number(report.bytesReceived || 0);
      });
      const stream = currentPeer.remoteStream;
      const audioLive = stream?.getAudioTracks().some(track => track.readyState === 'live' && !track.muted);
      const videoLive = stream?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);
      const videoEl = videoElementRef?.current;
      const frames = videoEl?.getVideoPlaybackQuality?.().totalVideoFrames ?? videoEl?.webkitDecodedFrameCount ?? 0;
      const audio = !!audioLive && totals.audio > previousRef.current.audio;
      const video = !!videoLive && totals.video > previousRef.current.video && (!videoEl || frames > previousRef.current.frames);
      previousRef.current = { ...totals, frames };
      if (!cancelled) setHealth({ audio, video, verified: Date.now() - startedAt >= 8_000 });
    };
    const interval = setInterval(() => void check(), 2_000);
    void check();
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, videoElementRef]);
  return health;
}
