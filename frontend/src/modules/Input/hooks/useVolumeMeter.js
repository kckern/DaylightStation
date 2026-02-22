import { useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useVolumeMeter' });
  return _logger;
}

/**
 * WebRTC volume meter.
 *
 * Web Audio API's createMediaStreamSource returns flat silence on Android
 * WebView (Shield). This hook adds the audio track to an RTCPeerConnection
 * and reads audioLevel from the sender's media-source stats, which reports
 * mic level via the native audio pipeline — bypassing Web Audio entirely.
 */
export const useVolumeMeter = (stream) => {
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    let stopped = false;
    let pollTimer = null;
    let pc = null;

    const setup = async () => {
      try {
        pc = new RTCPeerConnection();

        // Add audio track — this creates a sender whose media-source
        // stats report the mic's audio level
        pc.addTrack(audioTracks[0], stream);

        // Need a minimal SDP exchange so the encoder starts and
        // media-source stats populate. Loopback to self.
        const pc2 = new RTCPeerConnection();
        pc.onicecandidate = (e) => {
          if (e.candidate && !stopped) pc2.addIceCandidate(e.candidate);
        };
        pc2.onicecandidate = (e) => {
          if (e.candidate && !stopped) pc.addIceCandidate(e.candidate);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await pc2.setRemoteDescription(offer);
        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        await pc.setRemoteDescription(answer);

        if (stopped) { pc2.close(); return; }

        logger().debug('volume-meter-connected');

        // Poll media-source stats from sender
        let sampleCount = 0;
        let maxLevel = 0;
        pollTimer = setInterval(async () => {
          if (stopped) return;
          try {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (!sender) return;

            const stats = await sender.getStats();
            stats.forEach((report) => {
              if (report.type === 'media-source' && report.kind === 'audio') {
                if (report.audioLevel !== undefined) {
                  setVolume(report.audioLevel);
                  sampleCount++;
                  if (report.audioLevel > maxLevel) maxLevel = report.audioLevel;
                  // Log a summary every 5 seconds (50 samples at 100ms)
                  if (sampleCount % 50 === 0) {
                    logger().debug('volume-meter-sample', {
                      maxLevel: Math.round(maxLevel * 1000) / 1000,
                      samples: sampleCount,
                      trackLabel: sender.track?.label,
                      trackMuted: sender.track?.muted,
                      trackEnabled: sender.track?.enabled,
                    });
                    maxLevel = 0; // reset per window
                  }
                }
              }
            });
          } catch {
            // PC may have closed
          }
        }, 100);

        // Store pc2 for cleanup
        pc._loopbackPeer = pc2;
      } catch (err) {
        logger().warn('volume-meter-setup-failed', { error: err.message });
      }
    };

    setup();

    return () => {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (pc?._loopbackPeer) pc._loopbackPeer.close();
      if (pc) pc.close();
    };
  }, [stream]);

  return { volume };
};
