// frontend/src/modules/Player/lib/crtRenderer.js
//
// WebGL CRT renderer for upscaled low-resolution video.
//
// The point of the effect is faux-HD: a fine phosphor mask and scanline structure
// read as detail, so SD content stretched across a large panel looks denser rather
// than blocky. Two things follow from that and shape this file:
//
//   1. The mask pitch is fixed in OUTPUT pixels (`gl_FragCoord`), so the canvas
//      backing-store resolution decides how fine the mask reads. That is what
//      `renderScale` controls.
//   2. Compression artifacts are high-frequency too and compete with the mask for
//      the same perceptual channel, so the source is softened BEFORE the CRT pass
//      rather than after. A blur applied after the shader would smear the mask,
//      which is the opposite of what we want.
//
// Pipeline:
//   video → [H gaussian] → [V gaussian + mix back to source] → crt-geom → canvas
//           \____________ source resolution, two FBOs _______/
//
// Framework-free on purpose: no React in here, so it can be unit-tested and so the
// frame pump is not tied to render cycles.

import CRT_GEOM_SRC from '../shaders/crt-geom.glsl?raw';
import { createCrtFrameStats } from './crtFrameStats.js';

// crt-geom deltas from the shader's own defaults, settled 2026-08-18 in the CRT lab
// (frontend/public/crt-lab/). Everything not listed stays at the shader default,
// notably DOTMASK 0.3, scanline_weight 0.3, SHARPER 1, CURVATURE 1.
export const CRT_GEOM_PRESET = Object.freeze({
  CRTgamma: 1.9,
  INV: 1,
  R: 1.8,
  cornersize: 0.041
});

export const DEFAULT_PRE_FILTER = Object.freeze({
  // Radius is in SOURCE pixels — it dissolves block edges at the source's own
  // resolution instead of smearing the output.
  blurRadiusSourcePx: 1.25,
  blurMix: 1
});

// Separable gaussian over the source. Written in the same two-stage layout as the
// libretro shaders so both go through one compile path.
const PRE_BLUR_SRC = `
#if defined(VERTEX)
attribute vec4 VertexCoord; attribute vec4 TexCoord;
varying vec2 vT; uniform mat4 MVPMatrix;
void main(){ gl_Position = MVPMatrix * VertexCoord; vT = TexCoord.xy; }
#elif defined(FRAGMENT)
precision highp float;
varying vec2 vT;
uniform sampler2D Texture;      // what this pass blurs
uniform sampler2D TextureOrig;  // untouched source, for the mix on the final pass
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uRadius;
uniform float uMix;
uniform float uFinal;
void main(){
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  // Nine taps spanning +/- uRadius, gaussian-weighted in tap-index space.
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / 4.0);
    acc += texture2D(Texture, vT + uDir * uTexel * (fi * uRadius * 0.25)) * w;
    wsum += w;
  }
  vec4 blurred = acc / wsum;
  gl_FragColor = (uFinal > 0.5) ? mix(texture2D(TextureOrig, vT), blurred, uMix) : blurred;
}
#endif`;

const PRAGMA = /^#pragma parameter\s+(\w+)\s+"([^"]*)"\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/;

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const QUAD_POS = new Float32Array([-1, -1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, 1, 1, 0, 1]);
const QUAD_TEX = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]);
const QUAD_COL = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

/** Reads `#pragma parameter` metadata out of a libretro shader. */
export function parseShaderParams(src) {
  return String(src).split('\n').map((l) => l.match(PRAGMA)).filter(Boolean).map((m) => ({
    name: m[1], label: m[2], def: parseFloat(m[3]), min: parseFloat(m[4]), max: parseFloat(m[5])
  }));
}

/** Preset values layered over the shader's declared defaults. */
export function resolveParams(src, preset = CRT_GEOM_PRESET) {
  const out = {};
  for (const p of parseShaderParams(src)) {
    out[p.name] = preset[p.name] !== undefined ? preset[p.name] : p.def;
  }
  return out;
}

/**
 * Fits a source of `srcW`x`srcH` inside `dstW`x`dstH` with contain semantics,
 * returning the letterboxed viewport rect in device pixels.
 */
export function fitContain(srcW, srcH, dstW, dstH) {
  if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, w: 0, h: 0 };
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let w;
  let h;
  if (srcAspect > dstAspect) { w = dstW; h = Math.round(dstW / srcAspect); }
  else { h = dstH; w = Math.round(dstH * srcAspect); }
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

/**
 * Creates the renderer. Never throws: if WebGL or shader compilation is
 * unavailable the returned handle reports `supported: false` and the caller
 * falls back to the CSS overlay.
 *
 * @param {Object} options
 * @param {HTMLCanvasElement} options.canvas   - target canvas
 * @param {HTMLVideoElement} options.video     - decoding source (may stay hidden)
 * @param {Object} [options.params]            - crt-geom parameter overrides
 * @param {Object} [options.preFilter]         - { blurRadiusSourcePx, blurMix }
 * @param {number} [options.renderScale]       - backing-store multiplier over CSS px
 * @param {Object} [options.logger]            - child logger
 */
export function createCrtRenderer({
  canvas,
  video,
  params: paramOverrides,
  preFilter: preFilterInput,
  renderScale = 1,
  logger
} = {}) {
  const log = logger || { debug() {}, info() {}, warn() {}, error() {} };

  const unsupported = (reason, extra = {}) => {
    log.warn('crt.unsupported', { reason, ...extra });
    return { supported: false, reason, start() {}, stop() {}, resize() {}, setParams() {}, setPreFilter() {}, destroy() {}, stats: () => ({ drawn: 0, skipped: 0 }) };
  };

  if (!canvas || !video) return unsupported('missing-canvas-or-video');

  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
  } catch (e) {
    return unsupported('getcontext-threw', { error: e?.message });
  }
  if (!gl) return unsupported('no-webgl-context');

  // ---------------------------------------------------------------- programs
  function compile(type, src, tag) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`${tag} compile failed: ${info}`);
    }
    return s;
  }

  function build(src, tag) {
    // `#pragma parameter` is RetroArch metadata; some drivers complain about
    // unrecognised pragmas, so strip it before handing the source to GL.
    const body = String(src).split('\n').filter((l) => !PRAGMA.test(l)).join('\n');
    const vs = compile(gl.VERTEX_SHADER, `#define VERTEX\n#define PARAMETER_UNIFORM\n${body}`, `${tag}/vertex`);
    const fs = compile(gl.FRAGMENT_SHADER, `#define FRAGMENT\n#define PARAMETER_UNIFORM\n${body}`, `${tag}/fragment`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`${tag} link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniformCache = new Map();
    return {
      program,
      attr: {
        VertexCoord: gl.getAttribLocation(program, 'VertexCoord'),
        TexCoord: gl.getAttribLocation(program, 'TexCoord'),
        COLOR: gl.getAttribLocation(program, 'COLOR')
      },
      uni(name) {
        if (!uniformCache.has(name)) uniformCache.set(name, gl.getUniformLocation(program, name));
        return uniformCache.get(name);
      }
    };
  }

  let crtProg;
  let blurProg;
  try {
    crtProg = build(CRT_GEOM_SRC, 'crt-geom');
    blurProg = build(PRE_BLUR_SRC, 'pre-blur');
  } catch (e) {
    return unsupported('shader-build-failed', { error: e?.message });
  }

  // ---------------------------------------------------------------- resources
  const makeBuffer = (data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };
  const bufPos = makeBuffer(QUAD_POS);
  const bufTex = makeBuffer(QUAD_TEX);
  const bufCol = makeBuffer(QUAD_COL);

  const srcTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, srcTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const rt = [null, null];
  function ensureTargets(w, h) {
    for (let i = 0; i < 2; i++) {
      if (rt[i] && rt[i].w === w && rt[i].h === h) continue;
      if (rt[i]) { gl.deleteTexture(rt[i].tex); gl.deleteFramebuffer(rt[i].fb); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      rt[i] = { tex, fb, w, h };
    }
  }

  // ---------------------------------------------------------------- state
  let params = { ...resolveParams(CRT_GEOM_SRC), ...(paramOverrides || {}) };
  let preFilter = { ...DEFAULT_PRE_FILTER, ...(preFilterInput || {}) };
  let scale = renderScale;
  let view = { x: 0, y: 0, w: 0, h: 0 };
  let frameCount = 0;
  const frameStats = createCrtFrameStats();
  let running = false;
  let rvfcHandle = null;
  let rafHandle = null;
  let contextLost = false;
  let uploadFailed = false;

  const onContextLost = (e) => {
    e.preventDefault();
    contextLost = true;
    log.warn('crt.context-lost', {});
  };
  const onContextRestored = () => {
    // A restored context needs every GL object rebuilt; the hook remounts us
    // instead of trying to patch state back together in place.
    log.warn('crt.context-restored-needs-remount', {});
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function bindQuad(attr) {
    const bind = (loc, buf, size) => {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(attr.VertexCoord, bufPos, 4);
    bind(attr.TexCoord, bufTex, 4);
    bind(attr.COLOR, bufCol, 4);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const px = Math.max(1, Math.round(rect.width * dpr * scale));
    const py = Math.max(1, Math.round(rect.height * dpr * scale));
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== py) canvas.height = py;
    view = fitContain(video.videoWidth, video.videoHeight, px, py);
  }

  function runPreFilter(vw, vh) {
    ensureTargets(vw, vh);
    const { program, attr, uni } = blurProg;
    gl.useProgram(program);
    bindQuad(attr);
    gl.uniformMatrix4fv(uni('MVPMatrix'), false, IDENTITY);
    gl.uniform2f(uni('uTexel'), 1 / vw, 1 / vh);
    gl.uniform1f(uni('uRadius'), preFilter.blurRadiusSourcePx);
    gl.uniform1f(uni('uMix'), preFilter.blurMix);
    gl.uniform1i(uni('Texture'), 0);
    gl.uniform1i(uni('TextureOrig'), 1);
    gl.viewport(0, 0, vw, vh);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt[0].fb);
    gl.uniform2f(uni('uDir'), 1, 0);
    gl.uniform1f(uni('uFinal'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rt[1].fb);
    gl.uniform2f(uni('uDir'), 0, 1);
    gl.uniform1f(uni('uFinal'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rt[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return rt[1].tex;
  }

  // Returns whether a frame was actually painted, so the frame accounting does
  // not credit a draw that bailed out at one of the guards below.
  function drawFrame() {
    if (contextLost || uploadFailed) return false;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return false;

    if (view.w === 0 || canvas.width === 0) resize();

    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch (e) {
      // A protected/DRM surface taints the upload. Stop rather than spin on it —
      // the hook reads `failed` and falls back to the CSS overlay.
      uploadFailed = true;
      log.error('crt.texture-upload-failed', { error: e?.message, width: vw, height: vh });
      return false;
    }

    const source = preFilter.blurRadiusSourcePx > 0.001 ? runPreFilter(vw, vh) : srcTexture;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(view.x, view.y, view.w, view.h);

    const { program, attr, uni } = crtProg;
    gl.useProgram(program);
    bindQuad(attr);
    gl.uniformMatrix4fv(uni('MVPMatrix'), false, IDENTITY);
    gl.uniform1i(uni('Texture'), 0);
    gl.uniform1i(uni('FrameDirection'), 1);
    gl.uniform1i(uni('FrameCount'), frameCount);
    gl.uniform2f(uni('TextureSize'), vw, vh);
    gl.uniform2f(uni('InputSize'), vw, vh);
    gl.uniform2f(uni('OutputSize'), view.w, view.h);
    for (const key of Object.keys(params)) {
      const loc = uni(key);
      if (loc) gl.uniform1f(loc, params[key]);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frameCount++;
    return true;
  }

  // Drive off decoded frames where the browser offers it, so we do not burn a
  // draw per display refresh on 24fps content.
  const useRvfc = typeof video.requestVideoFrameCallback === 'function';
  // rVFC calls pump(now, metadata); rAF calls pump(now) with no metadata, so the
  // second argument is simply absent on the fallback path and no skip is read.
  function pump(_now, metadata) {
    if (!running) return;
    // Observe only a frame that actually reached the canvas. drawFrame() bails
    // out on a lost context, a failed upload or readyState < 2, and the pump
    // keeps re-arming through all of those — crediting those passes as draws
    // would report a busy canvas while the viewer is looking at black.
    // A gap in metadata.presentedFrames means the browser composited frames of
    // this element that our callback never painted: getVideoPlaybackQuality
    // cannot see this, it only counts DECODER drops.
    if (!drawFrame()) { schedule(); return; }
    const gap = frameStats.observe(metadata?.presentedFrames);
    if (gap > 0 && typeof log.sampled === 'function') {
      // Distinct keys on purpose: `skipped` is THIS gap, `skippedTotal` the
      // running total. Spreading the snapshot over a `skipped: gap` key would
      // silently overwrite the gap with the total and make the event lie.
      const totals = frameStats.snapshot();
      log.sampled(
        'crt.frames-skipped',
        {
          skipped: gap,
          mediaTime: metadata?.mediaTime ?? null,
          drawnTotal: totals.drawn,
          skippedTotal: totals.skipped
        },
        { maxPerMinute: 6, aggregate: true }
      );
    }
    schedule();
  }
  function schedule() {
    if (!running) return;
    if (useRvfc) rvfcHandle = video.requestVideoFrameCallback(pump);
    else rafHandle = requestAnimationFrame(pump);
  }

  log.info('crt.renderer-created', {
    driver: useRvfc ? 'requestVideoFrameCallback' : 'requestAnimationFrame',
    renderScale: scale,
    preBlurPx: preFilter.blurRadiusSourcePx
  });

  return {
    supported: true,
    get failed() { return uploadFailed || contextLost; },
    start() {
      if (running) return;
      running = true;
      resize();
      schedule();
      log.debug('crt.started', {});
    },
    stop() {
      const wasRunning = running;
      running = false;
      if (rvfcHandle != null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
      rvfcHandle = null;
      rafHandle = null;
      // destroy() also calls stop(), and stop() is idempotent, so only the
      // transition out of running reports the session's frame accounting.
      if (wasRunning) {
        log.info('crt.stopped', {
          driver: useRvfc ? 'requestVideoFrameCallback' : 'requestAnimationFrame',
          ...frameStats.snapshot()
        });
      }
    },
    stats: () => frameStats.snapshot(),
    resize,
    setParams(next) { params = { ...params, ...(next || {}) }; },
    setPreFilter(next) { preFilter = { ...preFilter, ...(next || {}) }; },
    setRenderScale(next) { scale = next; resize(); },
    destroy() {
      this.stop();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      for (const t of rt) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      gl.deleteTexture(srcTexture);
      gl.deleteBuffer(bufPos);
      gl.deleteBuffer(bufTex);
      gl.deleteBuffer(bufCol);
      gl.deleteProgram(crtProg.program);
      gl.deleteProgram(blurProg.program);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      log.debug('crt.destroyed', {});
    }
  };
}

export default createCrtRenderer;
