import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer.js';
import { useIndependentMedia } from '../modules/Input/hooks/useIndependentMedia.js';
import { useCallController } from './call/useCallController.js';
import './CallApp.scss';

const BUSY_COPY = 'This TV is already in a call.';
const mediaKindErrorCopy = (kind, reason) => {
  const label = kind === 'audio' ? 'Microphone' : 'Camera';
  if (reason === 'permission_denied') return `${label} access was denied. Allow access, then retry media.`;
  if (reason === 'hardware_missing') return `No usable ${kind === 'audio' ? 'microphone' : 'camera'} was found.`;
  if (reason === 'device_busy') return `The ${kind === 'audio' ? 'microphone' : 'camera'} is already in use by another app.`;
  if (reason === 'constraints_failed') return `${label} settings are not supported by this device.`;
  return `${label} could not be started.`;
};
const mediaErrorCopy = errors => {
  const reasons = Object.values(errors || {});
  if (reasons.includes('permission_denied')) return 'Camera or microphone access was denied. Allow access, then retry.';
  if (reasons.includes('hardware_missing')) return 'No usable camera or microphone was found.';
  if (reasons.includes('device_busy')) return 'The camera or microphone is already in use by another app.';
  if (reasons.includes('constraints_failed')) return 'This device does not support the requested media settings.';
  return 'Camera and microphone could not be started.';
};
const statusCopy = state => ({
  reserving: 'Reserving the TV…', probing: 'Checking the TV…', waking: state.reason === 'hard_recovery'
    ? 'Restarting the TV…' : state.reason === 'soft_recovery' ? 'Reloading the call app…' : 'Waking the TV…',
  waiting_tv: 'Waiting for the TV…', negotiating: 'Connecting securely…',
  verifying_media: 'Verifying audio and video…', reconnecting: 'Restoring the media link…',
  ending: 'Ending the call…', occupied: BUSY_COPY,
}[state.value] || '');

export default function CallApp() {
  useDocumentTitle('Call');
  // Logger children snapshot the root context. Configure this dedicated,
  // durable phone session before creating any call children.
  useMemo(() => configureLogger({ level: 'info', context: { app: 'homeline-phone', sessionLog: true } }), []);
  const logger = useMemo(() => getLogger().child({ component: 'CallApp' }), []);
  const media = useIndependentMedia();
  const peer = useWebRTCPeer(media.stream);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const primaryActionRef = useRef(null);
  const [devices, setDevices] = useState({ status: 'loading', items: [], error: null });
  const [hardConfirm, setHardConfirm] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const resumeCheckedRef = useRef(false);
  const controller = useCallController({ peer, mediaStatus: media.status,
    retryLocalMedia: media.retry, remoteVideoRef });
  const { state } = controller;
  const callLogFields = useMemo(() => ({
    callId: state.callId ?? null,
    attemptId: state.attemptId ?? null,
    dispatchId: state.dispatchId ?? null,
    deviceId: state.target?.id ?? null,
    phonePeerId: state.session?.peerId ?? null,
    state: state.value,
    reason: state.reason ?? null,
    peerRevision: state.peerRevision ?? null,
  }), [state]);

  useEffect(() => () => { configureLogger({ context: { sessionLog: false } }); }, []);

  const loadDevices = useCallback(() => {
    setDevices({ status: 'loading', items: [], error: null });
    DaylightAPI('/api/v1/device').then(data => {
      const items = (data.devices || []).filter(device => device.capabilities?.contentControl);
      setDevices({ status: 'ready', items, error: null });
      logger.info('devices.loaded', { count: items.length });
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
    const play = (attempt = 0) => element.play().then(() => logger.info('media.playback.succeeded', { ...callLogFields, attempt, outcome: 'ok' }))
      .catch(error => {
        if (attempt < 1) {
          logger.warn('media.playback.retry', { ...callLogFields, attempt, reason: error.name, outcome: 'retrying' });
          retry = setTimeout(() => void play(1), 150);
        } else logger.error('media.playback.failed', { ...callLogFields, attempt, reason: error.name, outcome: 'failed' });
      });
    void play();
    return () => clearTimeout(retry);
  }, [callLogFields, logger, peer.remoteStream]);

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
  const degradedLabel = state.media.audio && !state.media.video ? 'Audio-only call'
    : state.media.video && !state.media.audio ? 'Video-only call' : null;
  const toggleTrack = kind => {
    const track = media.stream?.getTracks().find(item => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    controller.sendMuteState({ audioMuted: media.stream.getAudioTracks().every(item => !item.enabled),
      videoMuted: media.stream.getVideoTracks().every(item => !item.enabled) });
  };
  const retryMediaAccess = async () => {
    try {
      await media.retry();
      controller.dispatch({ type: 'DISMISS' });
    } catch (error) {
      logger.warn('media.retry.failed', { reason: error.message });
    }
  };
  const exitCallScreen = () => window.history.back();

  return (
    <main className={`call-app ${inCall ? 'call-app--connected' : active ? 'call-app--connecting' : 'call-app--preview'}`}>
      <section className={`call-app__local ${inCall ? 'call-app__local--pip' : 'call-app__local--inset'}`} aria-label="Your camera preview">
        <video ref={localVideoRef} autoPlay muted playsInline className="call-app__video call-app__video--tall" />
        {media.status === 'loading' && <p className="call-app__camera-loading">Starting camera and microphone…</p>}
        {media.errors.video && <p className="call-app__camera-error">{mediaKindErrorCopy('video', media.errors.video)}</p>}
      </section>

      <section className="call-app__remote" aria-label="TV camera">
        <video ref={remoteVideoRef} autoPlay playsInline className="call-app__video call-app__video--wide" />
      </section>

      {inCall ? (
        <section className="call-app__controls" aria-live="polite">
          {degradedLabel && <div className="call-app__status-text call-app__status-text--error" role="status">{degradedLabel}</div>}
          {!state.controlConnected && <div className="call-app__status-text call-app__status-text--error" role="status">Controls reconnecting; media can continue.</div>}
          <button className="call-app__control-btn" onClick={() => toggleTrack('audio')} disabled={!media.stream?.getAudioTracks().length}>Microphone</button>
          <button className="call-app__control-btn" onClick={() => toggleTrack('video')} disabled={!media.stream?.getVideoTracks().length}>Camera</button>
          {state.value === 'degraded' && <button className="call-app__device-btn" onClick={controller.retryMedia}>Retry media</button>}
          <button className="call-app__hangup" onClick={() => controller.end('user_hangup')}>End call</button>
        </section>
      ) : (
        <section className="call-app__connecting-overlay" aria-live="polite">
          {(active || state.value === 'occupied') && <p className={`call-app__status-text${state.value === 'occupied' ? ' call-app__status-text--error' : ''}`} role={state.value === 'occupied' ? 'alert' : 'status'}>{statusCopy(state)}</p>}

          {state.value === 'recovery_prompt' && (
            <div role="alert" className="call-app__device-list">
              <p>The TV or media link did not recover.</p>
              {!hardConfirm ? <button ref={primaryActionRef} className="call-app__device-btn" onClick={() => setHardConfirm(true)} disabled={state.hardRecoveryUsed}>Restart TV…</button>
                : <button ref={primaryActionRef} className="call-app__device-btn" disabled={countdown > 0 || state.hardRecoveryUsed}
                    onClick={() => controller.dispatch({ type: 'HARD_RECOVERY', attemptId: state.attemptId })}>
                    {countdown > 0 ? `Confirm restart in ${countdown}` : 'Confirm restart'}
                  </button>}
              <button className="call-app__device-btn" onClick={() => controller.end('retry_requested')}>Try a new call</button>
              <button className="call-app__device-btn" onClick={() => controller.end('recovery_cancelled')}>End call</button>
            </div>
          )}

          {state.value === 'occupied' && <button ref={primaryActionRef} className="call-app__device-btn" onClick={() => controller.dispatch({ type: 'DISMISS' })}>Back</button>}
          {state.value === 'failed' && <div role="alert" className="call-app__device-list"><p>{state.reason === 'boot_failed' ? mediaErrorCopy(media.errors) : state.error}</p>
            {state.reason === 'boot_failed' && <button ref={primaryActionRef} className="call-app__device-btn" onClick={retryMediaAccess}>Retry media</button>}
            <button ref={state.reason === 'boot_failed' ? undefined : primaryActionRef} className="call-app__device-btn" onClick={() => controller.dispatch({ type: 'DISMISS' })}>Back</button></div>}

          {['idle', 'ended'].includes(state.value) && (
            <div className="call-app__device-list">
              {devices.status === 'loading' && <p role="status">Loading TVs…</p>}
              {devices.status === 'failed' && <div role="alert"><p>Could not load TVs.</p><button ref={primaryActionRef} className="call-app__device-btn" onClick={loadDevices}>Retry</button></div>}
              {devices.status === 'ready' && devices.items.length === 0 && <p>No video call TVs are configured.</p>}
              {devices.items.map((device, index) => <button key={device.id} ref={index === 0 ? primaryActionRef : undefined}
                className="call-app__device-btn" disabled={media.status !== 'ready'} onClick={() => controller.start(device)}>
                {devices.items.length === 1 ? `Call ${device.name || device.id}` : device.name || device.id}
              </button>)}
              {media.status === 'failed' && <div role="alert"><p>{mediaErrorCopy(media.errors)}</p><button className="call-app__device-btn" onClick={retryMediaAccess}>Retry media</button></div>}
              {media.status === 'ready' && media.errors.audio && <p role="status">
                {mediaKindErrorCopy('audio', media.errors.audio)} You can continue with video only.
              </p>}
              {media.status === 'ready' && media.errors.video && <p role="status">
                {mediaKindErrorCopy('video', media.errors.video)} You can continue with audio only.
              </p>}
              <button className="call-app__device-btn" onClick={exitCallScreen}>Exit call screen</button>
            </div>
          )}

          {active && state.value !== 'recovery_prompt' && <button ref={primaryActionRef} className="call-app__device-btn" onClick={() => controller.end('user_cancelled')}>Cancel</button>}
        </section>
      )}
    </main>
  );
}
