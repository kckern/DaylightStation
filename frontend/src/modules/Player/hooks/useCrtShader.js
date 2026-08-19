// frontend/src/modules/Player/hooks/useCrtShader.js
import { useEffect, useMemo, useRef, useState } from 'react';
import { getLogger } from '../../../lib/logging/Logger.js';
import { createCrtRenderer, CRT_GEOM_PRESET, DEFAULT_PRE_FILTER } from '../lib/crtRenderer.js';

/**
 * useCrtShader — mounts the WebGL CRT renderer over a video element.
 *
 * Detection stays in useUpscaleEffects; this hook only owns the render path. It
 * reports `active` so the caller can hide the video and `fellBack` so the caller
 * can put the CSS overlay up instead when WebGL is unavailable, the context is
 * lost, or the texture upload is refused (a DRM/protected surface).
 *
 * @param {Object} options
 * @param {React.RefObject} options.canvasRef  - canvas to render into
 * @param {React.RefObject} options.mediaRef   - the video element, or its host
 * @param {boolean} options.enabled            - whether the effect should run
 * @param {Object} [options.params]            - crt-geom parameter overrides
 * @param {Object} [options.preFilter]         - { blurRadiusSourcePx, blurMix }
 * @param {number} [options.renderScale]
 * @returns {{ active: boolean, fellBack: boolean }}
 */
export function useCrtShader({
  canvasRef,
  mediaRef,
  enabled = false,
  params,
  preFilter,
  renderScale = 1
} = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'crt-shader' }), []);
  const rendererRef = useRef(null);
  const [active, setActive] = useState(false);
  const [fellBack, setFellBack] = useState(false);

  // dash-video keeps the real <video> in shadow DOM.
  const resolveVideo = () => {
    const el = mediaRef?.current;
    if (!el) return null;
    if (el.shadowRoot) return el.shadowRoot.querySelector('video') || el;
    return el;
  };

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      setFellBack(false);
      return undefined;
    }
    const canvas = canvasRef?.current;
    const video = resolveVideo();
    if (!canvas || !video) return undefined;

    const renderer = createCrtRenderer({
      canvas, video, params, preFilter, renderScale, logger
    });
    rendererRef.current = renderer;

    if (!renderer.supported) {
      setActive(false);
      setFellBack(true);
      logger.warn('crt.fallback-to-css-overlay', { reason: renderer.reason });
      return () => { rendererRef.current = null; };
    }

    renderer.start();
    setActive(true);
    setFellBack(false);
    logger.info('crt.mounted', {
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      renderScale
    });

    // A refused texture upload only surfaces on the first draw, so watch for it
    // rather than assuming construction success means the effect is running.
    const failWatch = setInterval(() => {
      if (rendererRef.current && rendererRef.current.failed) {
        clearInterval(failWatch);
        renderer.stop();
        setActive(false);
        setFellBack(true);
        logger.warn('crt.fallback-after-failure', {});
      }
    }, 1000);

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    video.addEventListener('loadedmetadata', onResize);

    return () => {
      clearInterval(failWatch);
      window.removeEventListener('resize', onResize);
      video.removeEventListener('loadedmetadata', onResize);
      renderer.destroy();
      rendererRef.current = null;
      setActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canvasRef, mediaRef, logger, renderScale]);

  // Parameter tweaks should not tear the renderer down and remint everything.
  useEffect(() => {
    if (rendererRef.current?.supported) rendererRef.current.setParams(params);
  }, [params]);

  useEffect(() => {
    if (rendererRef.current?.supported) rendererRef.current.setPreFilter(preFilter);
  }, [preFilter]);

  return { active, fellBack };
}

export { CRT_GEOM_PRESET, DEFAULT_PRE_FILTER };
export default useCrtShader;
