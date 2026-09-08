import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer.js';
import { useIndependentMedia } from '../modules/Input/hooks/useIndependentMedia.js';
import { useCallController } from './call/useCallController.js';
import { deviceLabel } from './call/deviceLabel.js';
import { PhoneIcon, PowerIcon, HangupIcon, MicIcon, CameraIcon } from './call/callIcons.jsx';
import { AppThemeProvider } from '@/lib/ui';
import './CallApp.scss';

const BUSY_COPY = 'This TV is already in a call.';
const statusCopy = state => ({
  reserving: 'Reserving the TV…', probing: 'Checking the TV…', waking: state.reason === 'hard_recovery'
    ? 'Restarting the TV…' : state.reason === 'soft_recovery' ? 'Reloading the call app…' : 'Waking the TV…',
  waiting_tv: 'Waiting for the TV…', negotiating: 'Connecting securely…',
  verifying_media: 'Verifying audio and video…', reconnecting: 'Restoring the media link…',
  ending: 'Ending the call…', occupied: BUSY_COPY,
}[state.value] || '');

/**
 * What a household member is told when media will not start.
 *
 * The four reasons need four different actions — allow a permission, plug
 * something in, close the app holding the device, or change a setting — so a
 * single "media unavailable" line leaves someone at a wall phone with nothing
 * to do. `useIndependentMedia` already classifies the DOMException into these
 * reasons; this is only the wording.
 */
const mediaKindErrorCopy = (kind, reason) => {
  const label = kind === 'audio' ? 'Microphone' : 'Camera';
  if (reason === 'permission_denied') return `${label} access was denied. Allow access, then retry media.`;
  if (reason === 'hardware_missing') return `No usable ${kind === 'audio' ? 'microphone' : 'camera'} was found.`;
  if (reason === 'device_busy') return `The ${kind === 'audio' ? 'microphone' : 'camera'} is already in use by another app.`;
  if (reason === 'constraints_failed') return `${label} settings are not supported by this device.`;
  return `${label} could not be started.`;
};

/** The same, for a failure that names no single track. */
const mediaErrorCopy = (errors) => {
  const reasons = Object.values(errors || {});
  if (reasons.includes('permission_denied')) return 'Camera or microphone access was denied. Allow access, then retry.';
  if (reasons.includes('hardware_missing')) return 'No usable camera or microphone was found.';
  if (reasons.includes('device_busy')) return 'The camera or microphone is already in use by another app.';
  if (reasons.includes('constraints_failed')) return 'This device does not support the requested media settings.';
  return 'Camera and microphone could not be started.';
};

/**
 * Hold the viewport fixed for as long as the call screen is mounted.
 *
 * The app-wide meta tag allows pinch-zoom, which is right for a dense page and
 * wrong here: every control is already thumb-sized, and a caller who pinches
 * ends up panning a fixed-height layout with the controls off-screen. Scoped to
 * this surface and restored on unmount, so no other app inherits the lock.
 * `viewport-fit=cover` is what makes the safe-area insets this layout pads with
 * resolve to real values on a notched phone.
 */
const FIXED_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
function useFixedViewport() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', FIXED_VIEWPORT);
    return () => meta.setAttribute('content', previous);
  }, []);
}

export default function CallApp() {
  useDocumentTitle('Call');
  useFixedViewport();
  const logger = useMemo(() => getLogger().child({ component: 'CallApp' }), []);

  // Route this surface's events to the durable phone-side session trace under
  // media/logs/homeline-phone/. docs/reference/call/README.md sends a reader
  // there for "a browser that disconnected before it could ship its final
  // WebSocket log batch" — the one case where the live store has nothing — so
  // the file has to exist. Only `app` + `sessionLog` on the ROOT logger opens
  // it (see lib/logging/index.js), and child loggers inherit it, which is why
  // the child() above is not enough on its own.
  useEffect(() => {
    configureLogger({ level: 'info', context: { app: 'homeline-phone', sessionLog: true } });
    return () => configureLogger({ level: 'info', context: { sessionLog: false } });
  }, []);

  // What screen this actually rendered on. The session trace carries a user
  // agent, which does not say how wide the viewport was, whether the phone was
  // rotated, or whether the caller had pinch-zoomed to read the thing — so a
  // report of "I had to zoom in" had nothing in the log to check it against.
  // Emitted once on mount and again on rotation/resize, never per frame.
  useEffect(() => {
    const report = reason => logger.info('call.surface', {
      reason,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      // >1 means the page is not being read at the size we laid it out at.
      visualScale: window.visualViewport ? Number(window.visualViewport.scale.toFixed(2)) : null,
      orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
      touch: navigator.maxTouchPoints > 0,
    });
    report('mount');
    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => report('resize'), 400); };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [logger]);
  const media = useIndependentMedia();
  const peer = useWebRTCPeer(media.stream);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const primaryActionRef = useRef(null);
  const [devices, setDevices] = useState({ status: 'loading', items: [], error: null });
  const [hardConfirm, setHardConfirm] = useState(false);
  const [muted, setMuted] = useState({ audio: false, video: false });
  const [countdown, setCountdown] = useState(5);
  const resumeCheckedRef = useRef(false);
  const controller = useCallController({ peer, mediaStatus: media.status, remoteVideoRef });
  const { state } = controller;

  const loadDevices = useCallback(() => {
    setDevices({ status: 'loading', items: [], error: null });
    DaylightAPI('/api/v1/device').then(data => {
      // `videoCall`, not `contentControl`. Content control is what every kiosk
      // panel in the house has; it listed the office PC and two cameraless
      // tablets alongside the one TV that can actually take a call. A device
      // opts in with `video_call: true` in devices.yml.
      const all = data.devices || [];
      const items = all.filter(device => device.capabilities?.videoCall);
      setDevices({ status: 'ready', items, error: null });
      // A bare count cannot explain a wrong lobby. Naming what was offered and
      // what was withheld makes "why is the office TV in my call list" (or
      // "why is the living room missing") answerable from the log alone —
      // `withheld` is a devices.yml declaration, not a bug, and says so.
      logger.info('devices.loaded', {
        count: items.length,
        offered: items.map(device => device.id),
        // Only the plausible candidates — a screen someone could reasonably
        // expect in this list. Speakers, printers and cameras are not near
        // misses and would bury the answer under eighteen ids.
        withheld: all.filter(device => device.capabilities?.contentControl && !device.capabilities?.videoCall)
          .map(device => device.id),
        // A device offered under its raw slug means devices.yml declares no
        // `name` for it — the defect that put "yellow-room-tablet" on screen.
        unnamed: items.filter(device => !device.name).map(device => device.id),
      });
    }).catch(error => {
      setDevices({ status: 'failed', items: [], error: error.message });
      logger.warn('devices.failed', { reason: error.message });
    });
  }, [logger]);
  useEffect(loadDevices, [loadDevices]);
  useEffect(() => {
    if (resumeCheckedRef.current || state.value !== 'idle' || devices.status !== 'ready' || media.status !== 'ready') return;
    resumeCheckedRef.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem('homeline.activeCall') || 'null');
      const target = saved && devices.items.find(device => device.id === saved.deviceId);
      if (target && saved.callId) controller.resume(target, saved.callId);
      else sessionStorage.removeItem('homeline.activeCall');
    } catch { sessionStorage.removeItem('homeline.activeCall'); }
  }, [controller, devices, media.status, state.value]);

  useEffect(() => {
    if (!localVideoRef.current || !media.stream) return;
    localVideoRef.current.srcObject = new MediaStream(media.stream.getVideoTracks());
  }, [media.stream]);
  useEffect(() => {
    const element = remoteVideoRef.current;
    if (!element || !peer.remoteStream || peer.remoteStream.getTracks().length === 0) return undefined;
    element.srcObject = peer.remoteStream;
    let retry = null;
    const play = (attempt = 0) => element.play().then(() => logger.info('media.playback.succeeded', { attempt }))
      .catch(error => {
        if (attempt < 1) {
          logger.warn('media.playback.retry', { reason: error.name });
          retry = setTimeout(() => void play(1), 150);
        } else logger.error('media.playback.failed', { reason: error.name });
      });
    void play();
    return () => clearTimeout(retry);
  }, [logger, peer.remoteStream]);

  useEffect(() => { primaryActionRef.current?.focus(); }, [state.value, hardConfirm]);
  useEffect(() => {
    if (!hardConfirm) { setCountdown(5); return undefined; }
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown(value => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [countdown, hardConfirm]);
  useEffect(() => { if (state.value !== 'recovery_prompt') setHardConfirm(false); }, [state.value]);

  const active = !['booting', 'idle', 'ended', 'failed', 'occupied'].includes(state.value);
  const inCall = ['connected', 'degraded', 'reconnecting'].includes(state.value);
  const partialMediaNote = media.errors?.audio && !media.errors?.video
    ? 'You can continue with video only.'
    : media.errors?.video && !media.errors?.audio
      ? 'You can continue with audio only.'
      : null;
  const degradedLabel = state.media.audio && !state.media.video ? 'Audio-only call'
    : state.media.video && !state.media.audio ? 'Video-only call' : null;
  // Mute is mirrored in state, not read off the track. `track.enabled = false`
  // mutates an object React never re-renders for, so an icon driven straight
  // off the track would keep showing "live" after the caller muted — the one
  // thing a mute control must never get wrong.
  const audioMuted = muted.audio;
  const videoMuted = muted.video;
  const toggleTrack = kind => {
    const track = media.stream?.getTracks().find(item => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    const next = { audio: media.stream.getAudioTracks().every(item => !item.enabled),
      video: media.stream.getVideoTracks().every(item => !item.enabled) };
    setMuted(next);
    controller.sendMuteState({ audioMuted: next.audio, videoMuted: next.video });
  };

  return (
    <AppThemeProvider pack="home">
      <main className={`call-app ${inCall ? 'call-app--connected' : active ? 'call-app--connecting' : 'call-app--lobby'}`}>
        {/* The caller's own camera is the surface, not a thumbnail parked in
            dead space. It fills everything the controls do not need, so the
            lobby, the connecting state and the call all share one silhouette
            and nothing jumps when the state changes. */}
        <section className="call-app__stage" aria-label="Your camera preview">
          <video ref={localVideoRef} autoPlay muted playsInline className="call-app__video call-app__video--tall" />
          <div className="call-app__camera-status">
            {media.status === 'loading' && <p className="call-app__camera-loading">Starting camera and microphone…</p>}
            {media.errors.video && <p className="call-app__camera-error">{mediaKindErrorCopy('video', media.errors.video)}</p>}
            {media.errors.audio && <p className="call-app__camera-error">{mediaKindErrorCopy('audio', media.errors.audio)}</p>}
            {partialMediaNote && <p className="call-app__camera-note">{partialMediaNote}</p>}
          </div>
        </section>

        <section className="call-app__remote" aria-label="TV camera">
          <video ref={remoteVideoRef} autoPlay playsInline className="call-app__video call-app__video--wide" />
        </section>

        {inCall ? (
          <section className="call-app__panel call-app__panel--in-call" aria-live="polite">
            {degradedLabel && <p className="call-app__notice call-app__notice--warn" role="status">{degradedLabel}</p>}
            {!state.controlConnected && <p className="call-app__notice call-app__notice--warn" role="status">Controls reconnecting; media can continue.</p>}
            <div className="call-app__call-controls">
              <button type="button" className="call-app__round-btn" aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={audioMuted} onClick={() => toggleTrack('audio')} disabled={!media.stream?.getAudioTracks().length}>
                <MicIcon off={audioMuted} />
              </button>
              <button type="button" className="call-app__round-btn call-app__round-btn--hangup" aria-label="End call"
                onClick={() => controller.end('user_hangup')}>
                <HangupIcon size={26} />
              </button>
              <button type="button" className="call-app__round-btn" aria-label={videoMuted ? 'Turn camera on' : 'Turn camera off'}
                aria-pressed={videoMuted} onClick={() => toggleTrack('video')} disabled={!media.stream?.getVideoTracks().length}>
                <CameraIcon off={videoMuted} />
              </button>
            </div>
            {state.value === 'degraded' && <button type="button" className="call-app__text-btn" onClick={controller.retryMedia}>Retry media</button>}
          </section>
        ) : (
          <section className="call-app__panel" aria-live="polite">
            {(active || state.value === 'occupied') && (
              <p className={`call-app__notice${state.value === 'occupied' ? ' call-app__notice--warn' : ''}`}
                role={state.value === 'occupied' ? 'alert' : 'status'}>{statusCopy(state)}</p>
            )}

            {state.value === 'recovery_prompt' && (
              <div role="alert" className="call-app__stack">
                <p className="call-app__notice call-app__notice--warn">The TV or media link did not recover.</p>
                {!hardConfirm
                  ? <button type="button" ref={primaryActionRef} className="call-app__wide-btn" onClick={() => setHardConfirm(true)} disabled={state.hardRecoveryUsed}>Restart TV…</button>
                  : <button type="button" ref={primaryActionRef} className="call-app__wide-btn" disabled={countdown > 0 || state.hardRecoveryUsed}
                      onClick={() => controller.dispatch({ type: 'HARD_RECOVERY', attemptId: state.attemptId })}>
                      {countdown > 0 ? `Confirm restart in ${countdown}` : 'Confirm restart'}
                    </button>}
                <button type="button" className="call-app__wide-btn" onClick={() => controller.end('retry_requested')}>Try a new call</button>
                <button type="button" className="call-app__wide-btn call-app__wide-btn--danger" onClick={() => controller.end('recovery_cancelled')}>
                  <HangupIcon size={20} />End call
                </button>
              </div>
            )}

            {state.value === 'occupied' && <button type="button" ref={primaryActionRef} className="call-app__wide-btn" onClick={() => controller.dispatch({ type: 'DISMISS' })}>Back</button>}

            {state.value === 'failed' && (
              <div role="alert" className="call-app__stack">
                <p className="call-app__notice call-app__notice--warn">{state.reason === 'boot_failed' ? mediaErrorCopy(media.errors) : state.error}</p>
                <button type="button" ref={primaryActionRef} className="call-app__wide-btn" onClick={() => controller.dispatch({ type: 'DISMISS' })}>Back</button>
              </div>
            )}

            {['idle', 'ended'].includes(state.value) && (
              <div className="call-app__stack">
                {devices.status === 'loading' && <p className="call-app__notice" role="status">Looking for screens…</p>}
                {devices.status === 'failed' && (
                  <div role="alert" className="call-app__stack">
                    <p className="call-app__notice call-app__notice--warn">Could not load TVs.</p>
                    <button type="button" ref={primaryActionRef} className="call-app__wide-btn" onClick={loadDevices}>Retry</button>
                  </div>
                )}
                {devices.status === 'ready' && devices.items.length === 0 && <p className="call-app__notice">No screen in the house is set up to take a call.</p>}
                {devices.items.length > 0 && <h1 className="call-app__heading">Call a screen</h1>}

                {devices.items.map((device, index) => (
                  <button type="button" key={device.id} ref={index === 0 ? primaryActionRef : undefined}
                    className="call-app__target" disabled={media.status !== 'ready'} onClick={() => controller.start(device)}>
                    <span className="call-app__target-icon" aria-hidden="true">{device.icon || '📺'}</span>
                    <span className="call-app__target-label">
                      <span className="call-app__target-name">{deviceLabel(device)}</span>
                      {device.location && <span className="call-app__target-room">{device.location}</span>}
                    </span>
                    <span className="call-app__target-action" aria-hidden="true"><PhoneIcon /></span>
                  </button>
                ))}

                {media.status === 'failed' && (
                  <div role="alert" className="call-app__stack">
                    <p className="call-app__notice call-app__notice--warn">{mediaErrorCopy(media.errors)}</p>
                    <button type="button" className="call-app__wide-btn" onClick={media.retry}>Retry media</button>
                  </div>
                )}
                {media.status === 'ready' && (media.errors.audio || media.errors.video) && (
                  <p className="call-app__notice" role="status">You can call with {media.errors.audio ? 'video only' : 'audio only'}.</p>
                )}

                <button type="button" className="call-app__wide-btn call-app__wide-btn--danger" onClick={() => window.history.back()}>
                  <PowerIcon />Exit
                </button>
              </div>
            )}

            {active && state.value !== 'recovery_prompt' && (
              <button type="button" ref={primaryActionRef} className="call-app__wide-btn call-app__wide-btn--danger"
                onClick={() => controller.end('user_cancelled')}>
                <HangupIcon size={20} />Cancel
              </button>
            )}
          </section>
        )}
      </main>
    </AppThemeProvider>
  );
}
