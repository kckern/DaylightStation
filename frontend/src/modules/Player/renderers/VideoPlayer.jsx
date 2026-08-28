import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import 'dash-video-element';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from '../components/ProgressBar.jsx';
import { useUpscaleEffects } from '../hooks/useUpscaleEffects.js';
import { useCrtShader } from '../hooks/useCrtShader.js';
import { useRenderFpsMonitor } from '../hooks/useRenderFpsMonitor.js';
import { useEndOfContentWatchdog } from '../hooks/useEndOfContentWatchdog.js';
import { getLogger } from '../../../lib/logging/Logger.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { cleanupDashElement } from '../lib/dashCleanup.js';
import { changedKeyComponent } from '../lib/keyChange.js';
import { createStaleSessionWatchdog } from '../lib/staleSessionWatchdog.js';
import { buildFpsStatsPayload } from '../lib/fpsStatsPayload.js';
import { requestDashErrorRecovery } from '../lib/dashErrorRecovery.js';
import { readDashApiState } from '../lib/dashApiState.js';
import { useContentFilter } from '../../../lib/Player/useContentFilter.js';
import { useFilterData } from '../../../lib/Player/useFilterData.js';
import { REVIEW_GOTO } from '../../../lib/Player/reviewParams.js';
import { FilterOverlay } from '../components/FilterOverlay.jsx';
import { FilterDebugHud } from '../components/FilterDebugHud.jsx';
import { appendRefreshParam, withOffsetParam } from './dashStreamUrl.js';

// Content filtering is opt-in via ?filter=1 so normal playback is unaffected.
// The debug HUD (?filter-debug=1) implies filtering is on — it exists to QA cues.
const CONTENT_FILTER_DEBUG = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('filter-debug') === '1';
const CONTENT_FILTER_ENABLED = (typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('filter') === '1')
  || CONTENT_FILTER_DEBUG;

// Surgical review seek (?goto=<seconds>) is parsed in lib/Player/reviewParams.js and
// shared with Player (which suppresses the saved Plex resume when it's active) so the
// review target is authoritative. Cue-by-id review resolves to a ?goto time in the CLI.

// Per-mount identity for the recoveryLedger's 'dash-error' sub-budget. A module
// counter (not Math.random) so log payloads are deterministic across a session.
let _mountSeq = 0;

/**
 * The one place the <dash-video> key is spelled out. Both the element below and
 * the re-key log build from this, so a log line and the key it describes cannot
 * drift into two different formats.
 */
const buildDashElementKey = ({ mediaUrl, bitrate, elementKey }) => `${mediaUrl}:${bitrate}:${elementKey}`;

/**
 * Video player component for playing video content (including DASH video)
 */
export function VideoPlayer({
  media,
  advance,
  clear,
  shader,
  volume,
  playbackRate,
  setShader,
  cycleThroughClasses,
  classes,
  playbackKeys,
  queuePosition,
  fetchVideoInfo,
  ignoreKeys,
  onProgress,
  onMediaRef,
  keyboardOverrides,
  onController,
  upscaleEffects = 'auto',
  resilienceBridge
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.mediaType);
  // HLS streams (m3u8) play via hls.js (or native HLS on Safari). They use the
  // native <video> branch but WITHOUT a static src — the attach effect below
  // assigns the source.
  const isHls = media?.mediaType === 'hls_video';
  const hlsLogger = useMemo(() => getLogger().child({ component: 'video-player-hls' }), []);
  const [displayReady, setDisplayReady] = useState(false);
  const displayReadyLoggedRef = useRef(false);

  // Track resilienceBridge in a ref so the watchdog's onEscalate closure
  // (captured at first render) can always reach the current bridge instance.
  // The bridge identity changes on every render (Player.jsx passes an inline
  // arrow for onRequestRecovery), so a direct closure capture would go stale.
  const resilienceBridgeRef = useRef(resilienceBridge);
  useEffect(() => {
    resilienceBridgeRef.current = resilienceBridge;
  });

  // Track unmount state so the watchdog can bail if a late dash.js error
  // fires after the component has been torn down.
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  // Mount identity for the shared recoveryLedger: dash.error 27/28 → hardReset
  // escalations draw from a per-mount 'dash-error' budget (3), so a permanently
  // dead URL cannot infinite-loop, while every fired refresh still counts toward
  // the session-wide recovery cap (audit §3.1).
  const mountIdRef = useRef(null);
  if (!mountIdRef.current) mountIdRef.current = `video-mount-${++_mountSeq}`;

  const staleSessionWatchdogRef = useRef(null);
  if (!staleSessionWatchdogRef.current) {
    staleSessionWatchdogRef.current = createStaleSessionWatchdog({
      threshold: 3,
      windowMs: 10000,
      onEscalate: ({ errorCount, windowMs: wMs }) => {
        if (unmountedRef.current) return;
        playbackLog('playback.stale-session-detected', {
          errorCount,
          windowMs: wMs,
          action: 'escalating-to-resilience-recovery'
        }, { level: 'warn' });
        if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
          window.__fitnessRecoveryEvents = window.__fitnessRecoveryEvents || [];
          window.__fitnessRecoveryEvents.push({
            event: 'playback.stale-session-detected',
            ts: Date.now(),
            errorCount,
            windowMs: wMs
          });
        }
        const bridge = resilienceBridgeRef.current;
        if (typeof bridge?.requestRecovery === 'function') {
          bridge.requestRecovery({ reason: 'stale-session-detected' });
        }
      }
    });
  }

  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    duration,
    isStalled,
    handleProgressClick,
    elementKey,
    getMediaEl,
    getContainerEl
  } = useCommonMediaController({
    // ?goto overrides the start position so the transcode mints AT the target
    // (stall-free) and the saved resume can't fight it. Normal playback is unchanged.
    start: REVIEW_GOTO != null ? REVIEW_GOTO
      : (media.segment ? media.segment.start : media.seconds),
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'files',
    shader,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    keyboardOverrides,
    onController,
    recoverySessionKey: resilienceBridge?.playbackSessionKey || null,
    // Threaded from Player.jsx's forceSinglePlayerRemount diagnostics via
    // resilienceBridge (SinglePlayer.jsx) — not previously forwarded into this
    // call, so a resilience remount always armed autoplay regardless of pause
    // intent. See shouldArmAutoplay.
    remountDiagnostics: resilienceBridge?.remountDiagnostics ?? null
  });

  // Fallback queue-advance when HTML5 `ended` never fires. Plex transcode tails
  // are commonly zero-byte, so dash.js never calls endOfStream() and the element
  // parks at duration. The resilience jolt ladder deliberately ignores this state
  // (see useMediaResilience `atEnd`), which makes this watchdog the ONLY thing
  // that advances the queue. See docs/_wip/plans/2026-07-10-player-resilience-soak-defects.md
  useEndOfContentWatchdog({
    getMediaEl,
    sourceKey: media?.mediaKey || media?.src || media?.mediaUrl,
    onAdvance: advance,
    enabled: !!advance
  });

  // Upscale detection and effects
  const { effectStyles, overlayProps } = useUpscaleEffects({
    mediaRef: containerRef,
    preset: upscaleEffects
  });

  // WebGL CRT path. useUpscaleEffects still owns the decision (<=480p source,
  // stabilized, not looping); this only swaps how the effect is drawn. The CSS
  // overlay stays as the fallback for no-WebGL and refused texture uploads.
  const crtCanvasRef = useRef(null);
  const crt = useCrtShader({
    canvasRef: crtCanvasRef,
    mediaRef: containerRef,
    enabled: overlayProps.showCRT
  });
  const crtShaderActive = overlayProps.showCRT && crt.active;
  const crtOverlayFallback = overlayProps.showCRT && crt.fellBack;

  // --- Content filter (opt-in via ?filter=1) ---
  const filterContentId = (isPlex && CONTENT_FILTER_ENABLED)
    ? (media?.assetId || media?.key || media?.plex || null)
    : null;
  const filterData = useFilterData(filterContentId, { enabled: CONTENT_FILTER_ENABLED });
  const filterTransport = useMemo(() => ({
    seek: (s) => { const el = getMediaEl(); if (el && Number.isFinite(s)) { try { el.currentTime = s; } catch (_) { /* ignore */ } } },
  }), [getMediaEl]);
  const { activeOverlays: filterOverlays, activeCard: filterCard, effectiveCues: filterCues } = useContentFilter({
    getMediaEl,
    transport: filterTransport,
    edl: filterData?.edl,
    profile: filterData?.profile,
    override: filterData?.override,
    enabled: CONTENT_FILTER_ENABLED && !!filterData?.edl,
  });

  // Art for title/skip cards, via the Plex image proxy. The proxy keys on the
  // bare ratingKey — filterContentId carries a `plex:` prefix (it's the mediaKey),
  // which 404s the proxy and would blank every card's poster/background/logo. Strip
  // it (mirrors FilterPoc). Cards degrade per-image when a title lacks an art asset.
  const filterCardArt = useMemo(() => {
    if (!filterContentId) return null;
    const rk = String(filterContentId).replace(/^plex:/, '');
    const base = `/api/v1/proxy/plex/library/metadata/${rk}`;
    return { poster: `${base}/thumb`, background: `${base}/art`, logo: `${base}/clearLogo` };
  }, [filterContentId]);

  // Render FPS monitoring for blur overlay performance diagnosis
  // (emits its own playback telemetry; the return value is unused since the
  // quality HUD was deleted — audit 2026-07-09 §4.4)
  useRenderFpsMonitor({
    enabled: displayReady && !isPaused,
    mediaContext: {
      title: media?.title,
      grandparentTitle: media?.grandparentTitle,
      parentTitle: media?.parentTitle,
      mediaKey: media?.assetId || media?.key || media?.plex,
      shader
    }
  });

  // Track whether the browser has blocked autoplay (NotAllowedError).
  // Surfaced via resilienceBridge so Player.jsx can render the click-to-play overlay.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const autoplayBlockedRef = useRef(false);
  useEffect(() => {
    autoplayBlockedRef.current = autoplayBlocked;
  }, [autoplayBlocked]);

  const handleAutoplayResolved = useCallback(() => {
    // Guard: ignore if already resolving (prevents AbortError flood from rapid taps)
    if (!autoplayBlockedRef.current) return;
    setAutoplayBlocked(false); // Dismiss overlay immediately

    // Clear any pending seek intent — after autoplay block, the video should
    // play from its current position (0:00) rather than seeking to resume position.
    resilienceBridgeRef.current?.onSeekRequestConsumed?.();

    // Called from user gesture context (tap/key overlay).
    // <dash-video> is a web component with no play() method — must use the
    // inner <video> from shadow DOM directly.
    const el = containerRef.current;
    const inner = el?.shadowRoot?.querySelector('video, audio') || el;
    if (!inner) {
      playbackLog('autoplay-blocked-retry-no-element', {}, { level: 'warn' });
      return;
    }

    const p = inner.play?.();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        playbackLog('autoplay-blocked-resolved', { method: 'user-gesture' });
      }).catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoplayBlocked(true);
          playbackLog('autoplay-blocked-retry-failed', { error: 'NotAllowedError' }, { level: 'warn' });
        } else {
          playbackLog('autoplay-blocked-retry-failed', { error: err?.name || err?.message }, { level: 'warn' });
        }
      });
    } else {
      playbackLog('autoplay-blocked-retry-no-play-method', { tagName: inner?.tagName }, { level: 'warn' });
    }
  }, [containerRef]);

  // Hard reset: seek to position, reload, and resume playback.
  // Uses getMediaEl to traverse shadow DOM for dash-video,
  // falling back to containerRef for native video/audio.
  const hardReset = useCallback(({ seekToSeconds, refreshUrl = false } = {}) => {
    const target = getMediaEl() || containerRef.current;
    if (!target) return;
    const normalized = Number.isFinite(seekToSeconds) ? Math.max(0, seekToSeconds) : 0;

    // When the resilience state machine signals the URL may be stale
    // (Plex transcode session likely dead), mutate the <dash-video>
    // container's src BEFORE load(). The attribute change triggers
    // dash.js to re-fetch the MPD manifest, and the backend proxy
    // mints a fresh transcode session on that fresh call.
    if (refreshUrl) {
      const container = containerRef.current;
      const currentSrc = container?.getAttribute?.('src');
      if (currentSrc) {
        // Re-mint the transcode AT the seek target: rewrite offset= to the seek
        // position (else Plex restarts at the old offset and the target is still
        // past the transcoder's head → re-stalls). Then cache-bust so dash.js
        // re-fetches the MPD and the proxy mints a fresh session.
        const withOffset = Number.isFinite(normalized) && normalized > 0
          ? withOffsetParam(currentSrc, normalized)
          : currentSrc;
        const nextSrc = appendRefreshParam(withOffset, Date.now());
        try {
          container.setAttribute('src', nextSrc);
          playbackLog('playback.stream-url-refreshed', {
            previousSrc: currentSrc,
            nextSrc,
            offsetSeconds: Number.isFinite(normalized) ? Math.floor(normalized) : null,
            reason: 'hard-reset-with-refresh'
          });
          if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
            window.__fitnessRecoveryEvents = window.__fitnessRecoveryEvents || [];
            window.__fitnessRecoveryEvents.push({
              event: 'playback.stream-url-refreshed',
              ts: Date.now(),
              previousSrc: currentSrc,
              nextSrc
            });
          }
        } catch (err) {
          playbackLog('playback.stream-url-refresh-failed', {
            message: err?.message,
            previousSrc: currentSrc
          }, { level: 'warn' });
        }
      } else {
        playbackLog('playback.stream-url-refresh-skipped', {
          reason: 'no-current-src',
          hasContainer: !!container,
          hasMediaEl: !!getMediaEl(),
          tagName: container?.tagName || null
        }, { level: 'warn' });
      }
    }

    try { target.currentTime = normalized; } catch (_) {}
    target.load?.();
    const p = target.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoplayBlocked(true);
          playbackLog('autoplay-blocked', { source: 'hardReset' }, { level: 'warn' });
        }
      });
    }
  }, [containerRef, getMediaEl]);

  // Register accessors with resilience bridge
  useEffect(() => {
    if (resilienceBridge?.registerAccessors) {
      resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
    }
    // Also register with legacy onRegisterMediaAccess for backward compatibility
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl,
        hardReset,
        fetchVideoInfo: fetchVideoInfo || null,
        autoplayBlocked,
        onAutoplayResolved: handleAutoplayResolved
      });
    }
  }, [resilienceBridge, getMediaEl, getContainerEl, hardReset, fetchVideoInfo, autoplayBlocked, handleAutoplayResolved]);

  useEffect(() => {
    return () => {
      if (typeof resilienceBridgeRef.current?.onRegisterMediaAccess === 'function') {
        resilienceBridgeRef.current.onRegisterMediaAccess({});
      }
    };
  }, []);

  const { mediaUrl } = media;

  // SSOT for "which <dash-video> generation is this". Both the element key below
  // and the cleanup effect must read the same value, or a replaced element leaks
  // its dash.js MediaPlayer — it keeps fetching audio segments, and
  // dash-video-element has no disconnectedCallback to save us (2026-08-16 echo).
  const dashElementKeyInputs = {
    mediaUrl: mediaUrl || '',
    // 'unlimited' rather than a blank or a zero: an uncapped stream is a state
    // we measured, not a measurement we failed to take.
    bitrate: media?.maxVideoBitrate ?? 'unlimited',
    elementKey
  };
  const dashElementKey = buildDashElementKey(dashElementKeyInputs);

  // Clean up DASH resources per element generation, not just on unmount. With
  // `[]` deps this captured only the FIRST <dash-video>: because the element's
  // key includes mediaUrl, a url or bitrate change replaces the element WITHOUT
  // unmounting this component, so every later dash.js MediaPlayer leaked — still
  // fetching segments, still playing audio over the live one. On 2026-08-16 two
  // of them streamed the same lecture's audio at once, which is the doubled
  // sound the family reported.
  useEffect(() => {
    const el = containerRef.current;
    return () => { cleanupDashElement(el); };
  }, [dashElementKey, containerRef]);

  // Report which of the key's three inputs replaced the element. Every one of
  // them tears down a live <dash-video> and, on a Plex source, opens a fresh
  // transcode session — and until now not one of them was logged, which is why
  // the 2026-08-16 count had to be read out of Plex's server log instead of
  // ours. Runs in an effect rather than in render so it counts elements that
  // were actually committed.
  //
  // Sampled at 30/min. Unlike the player key above, nothing brakes this path:
  // a url refresh and a soft re-init can each churn it on their own, and during
  // the incident it ran at roughly 75/min. Thirty is high enough that ordinary
  // playback (a few per item) is recorded line by line, and low enough that a
  // storm lands in the aggregate, where the count is the diagnosis.
  const dashKeyInputsRef = useRef(null);
  const dashKeyLogger = useMemo(() => getLogger().child({ component: 'video-player-key' }), []);
  // The deps are the key's three inputs rather than the object built from them,
  // which is fresh on every render. Reading that object here is still exact: the
  // effect runs on the render whose inputs changed, so it sees that render's values.
  useEffect(() => {
    const next = dashElementKeyInputs;
    const previous = dashKeyInputsRef.current;
    dashKeyInputsRef.current = next;
    // No baseline means this is the first element of the mount, which is not a
    // re-key and has no `from` worth printing.
    const changedComponent = changedKeyComponent(previous, next);
    if (!changedComponent) return;
    dashKeyLogger.sampled('playback.dash-element-rekeyed', {
      from: buildDashElementKey(previous),
      to: buildDashElementKey(next),
      // `mediaUrl` is the recovery path re-minting a stream, `bitrate` is the
      // cap moving, `elementKey` is a soft re-init from the media controller.
      changedComponent,
      mountId: mountIdRef.current,
      // Distinguishes a <dash-video> (whose replacement costs a transcode
      // session) from the plain <video> branch, which shares this key.
      isDash: !!isDash
    }, { maxPerMinute: 30, aggregate: true });
    // deliberately narrow deps — this file has hard-won "generation churn / storm" caution comments elsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, media?.maxVideoBitrate, elementKey, isDash, dashKeyLogger]);

  // If the mediaUrl (or its effective bitrate cap) changes, reset display readiness so UI transitions are correct
  useEffect(() => {
    setDisplayReady(false);
    displayReadyLoggedRef.current = false;
  }, [mediaUrl, media?.maxVideoBitrate]);

  // HLS attach: load the m3u8 via hls.js (or native HLS where supported).
  // Lazy dynamic import so the (large) hls.js bundle only loads when an HLS
  // source is actually played, and never for dash/native video.
  useEffect(() => {
    if (media?.mediaType !== 'hls_video') return undefined;
    const video = containerRef.current;
    if (!video || !mediaUrl) return undefined;
    // Safari & co. play HLS natively:
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = mediaUrl;
      hlsLogger.info('video.hls.native', { mediaUrl });
      return undefined;
    }
    let hls;
    let cancelled = false;
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !containerRef.current) return;
      if (!Hls.isSupported()) {
        hlsLogger.warn('video.hls.unsupported', { mediaUrl });
        return;
      }
      hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, data) => hlsLogger.warn('video.hls.error', { fatal: data?.fatal, type: data?.type }));
      hls.loadSource(mediaUrl);
      hls.attachMedia(containerRef.current);
      hlsLogger.info('video.hls.attached', { mediaUrl });
    }).catch((e) => hlsLogger.error('video.hls.load_failed', { error: e?.message }));
    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [media?.mediaType, mediaUrl, hlsLogger, containerRef]);

  // Handle dash-video custom element events (web components don't support React synthetic events)
  useEffect(() => {
    if (!isDash) return;
    const el = containerRef.current;
    if (!el) return;

    const handleReady = () => {
      setDisplayReady(true);
      // Prod telemetry: video display ready (one-time per media)
      if (!displayReadyLoggedRef.current) {
        displayReadyLoggedRef.current = true;
        const logger = getLogger();
        logger.info('playback.video-ready', {
          title: media?.title,
          grandparentTitle: media?.grandparentTitle,
          parentTitle: media?.parentTitle,
          mediaKey: media?.assetId || media?.key || media?.plex,
          readyTs: Date.now()
        });
      }
    };

    // --- dash.js diagnostic logging ---
    const dashLog = getLogger().child({ component: 'dash-diag' });

    // Origin for msFromMountToApiReady. This effect re-runs per <dash-video>
    // generation, so the clock starts when this element generation began rather
    // than when the component first mounted — which is the interval that matters,
    // because each generation gets its own dash.js MediaPlayer.
    const generationStartedAt = Date.now();
    let apiReached = false;
    let neverReadyEmitted = false;

    // Describes the element for either "we never got an api" emission. Kept in
    // one place so the two reasons carry identical fields and can be counted
    // together.
    const elementFacts = () => ({
      mountId: mountIdRef.current,
      elTag: el.tagName ? el.tagName.toLowerCase() : null,
      src: el.src ? String(el.src).substring(0, 150) : null
    });

    // Without this the poll below is unbounded and emits nothing when it never
    // succeeds, so a dash.js that never initialised and a subscription that
    // merely arrived late produce the same evidence: silence. Fifteen seconds is
    // far past a healthy attach (sub-second in the field) and still short enough
    // to land inside the element generation that failed.
    const API_READY_TIMEOUT_MS = 15000;
    const apiNeverReadyTimer = setTimeout(() => {
      if (apiReached) return;
      neverReadyEmitted = true;
      dashLog.warn('dash.api-never-ready', {
        reason: 'timeout',
        msWaited: Date.now() - generationStartedAt,
        ...elementFacts()
      });
    }, API_READY_TIMEOUT_MS);

    const waitForApi = setInterval(() => {
      if (!el.api) return;
      clearInterval(waitForApi);
      apiReached = true;
      const api = el.api;

      // Read the player's current state as well as subscribing. The old payload
      // counted event constants on the constructor, which is 0 on this build and
      // said nothing either way about whether the stream was running.
      const { state, unreadable } = readDashApiState(api);

      dashLog.info('dash.api-ready', {
        src: el.src,
        msFromMountToApiReady: Date.now() - generationStartedAt,
        // True means the timeout above already declared this player dead and it
        // came back — the subscription is live but every event before now is lost.
        afterNeverReadyTimeout: neverReadyEmitted,
        ...state,
        // Empty means every accessor answered; a named field here means that
        // field's null is "not measured", not "measured as nothing".
        unreadable
      });

      let consecutiveEmptyFragments = 0;
      const EMPTY_FRAGMENT_THRESHOLD = 6;

      // Manifest loaded
      api.on('manifestLoaded', (e) => {
        dashLog.info('dash.manifest-loaded', {
          url: e?.data?.url?.substring(0, 120),
          type: e?.data?.type,
          duration: e?.data?.mediaPresentationDuration
        });
        staleSessionWatchdogRef.current?.reset();
      });

      // Stream initialized
      api.on('streamInitialized', (e) => {
        dashLog.info('dash.stream-initialized', { streamInfo: e?.streamInfo?.id });
      });

      // Fragment loading
      api.on('fragmentLoadingStarted', (e) => {
        const r = e?.request;
        dashLog.info('dash.fragment-loading', {
          type: r?.mediaType,
          url: r?.url?.substring(0, 150),
          index: r?.index,
          startTime: r?.startTime,
          duration: r?.duration
        });
      });

      api.on('fragmentLoadingCompleted', (e) => {
        const r = e?.request;
        const resp = e?.response;
        const bytes = resp?.byteLength ?? resp?.length ?? null;

        dashLog.info('dash.fragment-loaded', {
          type: r?.mediaType,
          index: r?.index,
          startTime: r?.startTime,
          bytes,
          status: r?.requestEndDate ? 'ok' : 'unknown'
        });

        if (bytes === 0 || bytes === null) {
          consecutiveEmptyFragments++;
          if (consecutiveEmptyFragments === EMPTY_FRAGMENT_THRESHOLD) {
            dashLog.warn('dash.transcode-warming', {
              consecutiveEmpty: consecutiveEmptyFragments,
              lastType: r?.mediaType,
              lastIndex: r?.index,
              lastStartTime: r?.startTime
            });
            el.dispatchEvent(new CustomEvent('transcodewarming', {
              detail: { consecutiveEmpty: consecutiveEmptyFragments }
            }));
          }
        } else {
          if (consecutiveEmptyFragments > 0) {
            dashLog.info('dash.transcode-warmed', {
              emptyCount: consecutiveEmptyFragments,
              firstDataType: r?.mediaType,
              firstDataIndex: r?.index,
              firstDataBytes: bytes
            });
            el.dispatchEvent(new CustomEvent('transcodewarmed'));
          }
          consecutiveEmptyFragments = 0;
        }
      });

      api.on('fragmentLoadingAbandoned', (e) => {
        const r = e?.request;
        dashLog.warn('dash.fragment-abandoned', {
          type: r?.mediaType,
          url: r?.url?.substring(0, 150),
          index: r?.index
        });
      });

      // Buffer events
      api.on('bufferLevelUpdated', (e) => {
        if (Math.random() < 0.1) { // sample 10% to avoid log spam
          dashLog.info('dash.buffer-level', {
            type: e?.mediaType,
            level: e?.bufferLevel?.toFixed(2)
          });
        }
      });

      api.on('bufferStalled', (e) => {
        dashLog.warn('dash.buffer-stalled', { type: e?.mediaType });
      });

      // Playback events
      api.on('playbackStarted', () => {
        dashLog.info('dash.playback-started');
        staleSessionWatchdogRef.current?.reset();
      });
      api.on('playbackSeeking', (e) => dashLog.info('dash.seeking', { seekTime: e?.seekTime }));
      api.on('playbackSeeked', () => dashLog.info('dash.seeked'));
      api.on('playbackWaiting', () => dashLog.warn('dash.waiting'));
      api.on('playbackStalled', () => dashLog.warn('dash.playback-stalled'));

      // Errors — critical
      api.on('error', (e) => {
        const code = e?.error?.code;
        const message = e?.error?.message?.substring(0, 200);
        dashLog.error('dash.error', {
          error: code,
          message,
          data: e?.error?.data ? JSON.stringify(e.error.data).substring(0, 300) : null
        });
        staleSessionWatchdogRef.current?.recordError({ code, message });

        // Bug 2026-05-23 §2: source-URL errors (code 27 segment unavailable,
        // 28 manifest/init unavailable) signal a dead Plex transcode session.
        // Escalate to hardReset with refreshUrl so the backend mints a fresh
        // transcode. Gated by the shared recoveryLedger: 3 per mount for the
        // 'dash-error' actor, counted against the session-wide cap (audit §3.1).
        const { fire, decision, gate } = requestDashErrorRecovery({
          errorCode: code,
          sessionKey: resilienceBridgeRef.current?.playbackSessionKey || null,
          mountId: mountIdRef.current
        });
        if (fire) {
          const innerEl = getMediaEl();
          const seekToSeconds = (innerEl && Number.isFinite(innerEl.currentTime)) ? innerEl.currentTime : 0;
          dashLog.warn('dash.error-recovery', {
            action: 'refresh-url',
            reason: decision.reason,
            attempt: gate.attempt,
            seekToSeconds
          });
          hardReset({ seekToSeconds, refreshUrl: true });
        } else if (gate) {
          // Refreshable code, but the ledger denied it (mount budget spent or
          // session cap reached). The stale-session watchdog remains the
          // escalation route (bridge.requestRecovery → triggerRecovery).
          //
          // Warn, not debug: production runs at info, so at debug this line
          // vanished and a dash-error storm that had spent its budget showed up
          // only as `dash.error` lines that stopped having any consequence, with
          // nothing saying why. Volume is bounded by the `dash.error` handler
          // above, which already emits at error level for the same events, so
          // raising this cannot make the stream noisier than it already is.
          dashLog.warn('dash.error-recovery-budget-denied', {
            reason: decision.reason,
            deniedBy: gate.deniedBy,
            attempt: gate.attempt
          });
        }
      });

      // Quality/representation changes
      api.on('qualityChangeRendered', (e) => {
        dashLog.info('dash.quality-change', {
          type: e?.mediaType,
          oldQuality: e?.oldQuality,
          newQuality: e?.newQuality
        });
      });
    }, 100);
    // --- end dash.js diagnostic logging ---

    // Detect autoplay block: Firefox won't fire canplay when autoplay is blocked
    // (readyState stays at 1). Poll the inner <video> after 3s — if it's still
    // paused, try play() to surface NotAllowedError.
    const autoplayCheckTimer = setTimeout(() => {
      const inner = el.shadowRoot?.querySelector('video, audio') || el;
      if (inner.paused) {
        const p = inner.play?.();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (err?.name === 'NotAllowedError') {
              setAutoplayBlocked(true);
              playbackLog('autoplay-blocked', { source: 'initial-autoplay' }, { level: 'warn' });
            }
          });
        }
      }
    }, 3000);

    const handlePlaying = () => {
      handleReady();
      setAutoplayBlocked(false);
    };

    el.addEventListener('canplay', handleReady);
    el.addEventListener('playing', handlePlaying);

    return () => {
      el.removeEventListener('canplay', handleReady);
      el.removeEventListener('playing', handlePlaying);
      clearTimeout(autoplayCheckTimer);
      clearInterval(waitForApi);
      clearTimeout(apiNeverReadyTimer);

      // An element torn down before its api appeared is the storm signature: on
      // 2026-08-16 generations were replaced every few seconds, far inside the
      // timeout above, so the timeout alone would have recorded none of them.
      // Sampled because that is exactly the case where this fires most, and the
      // aggregate count is the diagnosis.
      if (!apiReached && !neverReadyEmitted) {
        dashLog.sampled('dash.api-never-ready', {
          reason: 'torn-down-before-ready',
          msWaited: Date.now() - generationStartedAt,
          // True means the api did appear, in the window between the last poll
          // tick and this teardown — the player initialised and we still never
          // subscribed to it.
          apiPresentAtTeardown: !!el.api,
          ...elementFacts()
        }, { maxPerMinute: 30, aggregate: true });
      }
    };
    // deliberately narrow deps — this file has hard-won "generation churn / storm" caution comments elsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDash, mediaUrl, elementKey]);

  // FPS logging every 10 seconds during playback
  // TIMER THRASHING FIX: Use ref for timer ID and stable dependencies
  const fpsIntervalRef = useRef(null);
  const fpsLoggingActiveRef = useRef(false);

  useEffect(() => {
    // Clear any existing timer first to prevent duplicates
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current);
      fpsIntervalRef.current = null;
    }

    // Only log if video is playing (not paused, not stalled, has started)
    const shouldLog = !isPaused && !isStalled && seconds > 0 && displayReady;
    
    if (!shouldLog) {
      fpsLoggingActiveRef.current = false;
      return;
    }

    fpsLoggingActiveRef.current = true;

    fpsIntervalRef.current = setInterval(() => {
      // Re-check conditions inside interval since they may change
      if (!fpsLoggingActiveRef.current) return;

      const logger = getLogger();
      const mediaEl = getMediaEl();

      // Audit 2026-05-23 §4.1: read from latestDataRef so the payload
      // reflects the current React state, not the values captured when
      // this useEffect was last created. The bug: every fps_stats event
      // in a 5.5-minute Bluey session reported currentTime: 107 even as
      // real playback advanced to 441s.
      const snap = latestDataRef.current;

      // Calculate instantaneous FPS if available (snapshot-consistent).
      let estimatedFps = null;
      if (mediaEl && typeof mediaEl.requestVideoFrameCallback === 'function') {
        estimatedFps = 'supported';
      }

      logger.info('playback.fps_stats',
        buildFpsStatsPayload(snap, { estimatedFps })
      );
    }, 10000); // 10 seconds

    return () => {
      fpsLoggingActiveRef.current = false;
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
    };
    // deliberately narrow deps — this file has hard-won "generation churn / storm" caution comments elsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, isStalled, displayReady]); // Reduced dependencies - only track state changes that determine timer creation

  // The bitrate cap only ever comes from media metadata now — the ABR engine
  // that could adapt it was unreachable and has been deleted (audit §4.4).
  const bitrateCapKbps = Number.isFinite(media?.maxVideoBitrate) ? Number(media.maxVideoBitrate) : null;

  // Keep refs up to date with latest values for use in interval callback
  const latestDataRef = useRef({ seconds, currentMaxKbps: bitrateCapKbps, duration, media, isDash, shader });
  useEffect(() => {
    latestDataRef.current = { seconds, currentMaxKbps: bitrateCapKbps, duration, media, isDash, shader };
  }, [seconds, bitrateCapKbps, duration, media, isDash, shader]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
    
  
  
  return (
    <div className={`video-player ${shader}`}>
      <ProgressBar
        percent={percent}
        onClick={handleProgressClick}
        durationSeconds={Number.isFinite(duration) ? duration : 0}
        offsetSeconds={Number.isFinite(seconds) ? seconds : null}
        paused={isPaused || isStalled}
        playbackRate={playbackRate || 1}
      />
      {isDash ? (
        <dash-video
          key={dashElementKey}
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''} ${crtShaderActive ? 'crt-source' : ''}`}
          src={mediaUrl}
          autoplay=""
          style={crtShaderActive ? undefined : effectStyles}
        />
      ) : (
        <video
          key={dashElementKey}
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''} ${crtShaderActive ? 'crt-source' : ''}`}
          src={isHls ? undefined : mediaUrl}
          style={crtShaderActive ? undefined : effectStyles}
          onCanPlay={() => setDisplayReady(true)}
          onPlaying={() => setDisplayReady(true)}
        />
      )}
      {overlayProps.showCRT && (
        <canvas
          ref={crtCanvasRef}
          className={`upscale-crt-canvas ${crtShaderActive ? 'active' : ''}`}
          aria-hidden="true"
        />
      )}
      {crtOverlayFallback && (
        <div className={overlayProps.className} />
      )}
      {CONTENT_FILTER_ENABLED && filterData?.edl && (
        <FilterOverlay
          activeOverlays={filterOverlays}
          activeCard={filterCard}
          theme={filterData?.profile?.theme}
          art={filterCardArt}
        />
      )}
      {CONTENT_FILTER_DEBUG && filterData?.edl && (
        <FilterDebugHud
          getMediaEl={getMediaEl}
          transport={filterTransport}
          effectiveCues={filterCues}
          theme={filterData?.profile?.theme}
        />
      )}
    </div>
  );
}

VideoPlayer.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  shader: PropTypes.string,
  volume: PropTypes.number,
  playbackRate: PropTypes.number,
  setShader: PropTypes.func,
  cycleThroughClasses: PropTypes.func,
  classes: PropTypes.arrayOf(PropTypes.string),
  playbackKeys: PropTypes.arrayOf(PropTypes.string),
  queuePosition: PropTypes.number,
  fetchVideoInfo: PropTypes.func,
  ignoreKeys: PropTypes.bool,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  onController: PropTypes.func,
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none']),
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    seekToIntentSeconds: PropTypes.number,
    onSeekRequestConsumed: PropTypes.func,
    requestRecovery: PropTypes.func,
    playbackSessionKey: PropTypes.string,
    remountDiagnostics: PropTypes.shape({
      wasPaused: PropTypes.bool
    })
  })
};
