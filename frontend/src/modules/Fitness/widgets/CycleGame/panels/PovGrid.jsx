import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import { povWorld, povBadges, resolveBadgeStack } from '@/modules/Fitness/lib/cycleGame/povWorld.js';
import { povFollowCam, horizonChipState } from '@/modules/Fitness/lib/cycleGame/povFollowCam.js';
import getLogger from '@/lib/logging/Logger.js';
import './PovGrid.scss';

// World / grid (must match povWorld defaults).
const RACE_TICK_MS = 1000;   // matches RACE_TICK_MS data cadence
const ROAD_HALF_W = 4;       // road spans x ∈ [-4, +4] world units
const LANE_INSET = 0.85;     // riders spread across ±halfW*inset
const BADGE_STACK_GAP_PX = 3; // vertical breathing room when badges de-collide
const GRID_MINOR_M = 1;      // minor metre mark spacing
const GRID_MAJOR_M = 10;     // shader road-stripe spacing (visual grid density — unrelated to labels)
// DOM metre-label spacing (audit UX §7): widened from every 10 m to every
// 100 m so the label can earn the 1.1rem 10-foot floor without crowding the
// narrow rider-anchored strip (a 10 m cadence would stack 5-6+ labels in the
// typical ~55 m visible span at the bumped font size). Deliberately a
// SEPARATE constant from GRID_MAJOR_M — that one still feeds the shader's
// uMajor uniform (road-surface line density), which this does not touch.
const LABEL_MAJOR_M = 100;
const AHEAD_M = 25;          // road drawn ahead of the leader (frames leader high)
const BEHIND_M = 30;         // road drawn behind last place (rider-anchored marks/gates)
const MIN_SPAN_M = 20;       // min framed span → max-zoom cap
const FOG_FAR_M = 220;       // fog cutoff floor — scaled UP per-frame to keep a compressed leader visible
const GRACE_MS = 5000;       // start grace: frame the whole start line before excluding not-yet-moved riders
const HORIZON_SHOW_M = 120;  // true leader gap that surfaces the horizon "LEADER +Nm" chip (hysteresis)

// Camera follow (camera-controls). smoothTime is the damping knob (no whiplash).
const SMOOTH_TIME = 0.5;
const MIN_DIST = 8;          // closest dolly — the hard max-zoom cap
const MAX_DIST = 150;        // farthest dolly — whole-field spread

// Look-at geometry (tuned on kiosk).
const CAM_FILL = 0.95;       // camDist ≈ span * CAM_FILL (clamped to MIN/MAX_DIST)
const CAM_BEHIND = 0.55;     // camera sits this * camDist behind last place
const CAM_ELEV = 0.42;       // camera elevation = this * camDist
const LOOK_AHEAD = 0.35;     // look at a point this fraction into the span (leader sits high)

// Avatar card scale: clamp(MIN..MAX, CARD_FOCAL / distanceToCamera). The avatar is
// rendered at 88px intrinsic and only ever DOWN-scaled (max 0.75) so the bitmap is
// downsampled, never upscaled — crisp against the shader grid. On-screen size is
// unchanged from the old 44px/1.5 setup (88*0.75 = 66 = 44*1.5).
const CARD_FOCAL = 13;
const CARD_MIN_SCALE = 0.45;  // raised (was 0.225): a gap-compressed far leader stays a readable card, not a dot
const CARD_MAX_SCALE = 0.75;

// Neon palette.
const BG = 0x0a0118;
const MAGENTA = 0xff40a0;
const GOLD = 0xffc846;
const GRID_MINOR_COLOR = 0x1fb6d8;  // dim cyan (1 m lines)
const GRID_MAJOR_COLOR = 0x5cf2ff;  // bright cyan (10 m lines)
const MINOR_FADE_M = 70;            // 1 m lines fade out by ~70 m (majors persist to fog)
const GRID_PLANE_Z = 4000;          // ground-plane length (world units)
// Ground-plane HALF-width (visual only — the playable road/lane width used for
// rider positions and gate arches stays ROAD_HALF_W). The plane used to be
// locked to 2*ROAD_HALF_W = 8 units wide; at a big-gap zoom-out (camDist up to
// MAX_DIST) the camera's horizontal FOV covers far more than 8 units, so the
// ground shrank to a narrow center strip with empty voids on both sides
// instead of anchoring to the frame's full width. The shader keys off world-
// space vWorldPos (not a normalized plane UV — see GRID_FRAG), so widening
// this costs nothing and can't stretch/distort the grid.
const GRID_PLANE_HALF_W = MAX_DIST * 2;

// Pools.
const GATE_POOL = 10;        // simultaneous lap/finish arches
const MAJOR_LABEL_POOL = 30; // simultaneous off-road metre labels
const ARCH_H = 3.2;          // gate arch height (world units)

// Procedural ground-plane grid. A fragment shader draws world-anchored 1 m + 10 m
// lines whose width is measured in *pixels* via screen-space derivatives (fwidth),
// so each line stays a crisp ~1 px regardless of depth and never bunches into a
// sub-pixel moiré (the cause of thin-line shimmer). One plane replaces both the
// longitudinal rails and the lateral metre trusses.
const GRID_VERT = `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const GRID_FRAG = `
  precision highp float;
  varying vec3 vWorldPos;
  uniform float uMinor, uMajor, uFogNear, uFogFar, uMinorFar;
  uniform vec3 uMinorColor, uMajorColor, uCamPos;
  // Analytic line coverage: distance to the nearest integer line, measured in
  // pixels, anti-aliased over the last pixel. halfPx = half the line width in px.
  float lineCov(vec2 uv, float halfPx) {
    vec2 d = vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))),
                  length(vec2(dFdx(uv.y), dFdy(uv.y))));
    vec2 g = abs(fract(uv + 0.5) - 0.5) / max(d, vec2(1e-6));
    return 1.0 - clamp(min(g.x, g.y) - halfPx, 0.0, 1.0);
  }
  void main() {
    vec2 xz = vWorldPos.xz;
    float minor = lineCov(xz / uMinor, 0.6);
    float major = lineCov(xz / uMajor, 1.1);
    float dist = distance(vWorldPos, uCamPos);
    float fog = 1.0 - clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    float minorFade = 1.0 - smoothstep(uMinorFar * 0.55, uMinorFar, dist);
    float a = max(minor * 0.45 * minorFade, major * 0.95) * fog;
    if (a < 0.003) discard;
    vec3 col = mix(uMinorColor, uMajorColor, step(0.5, major));
    gl_FragColor = vec4(col, a);
  }
`;

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * three.js POV race road. A WebGLRenderer draws the neon grid (rails + metre
 * trusses) and lap/finish arches in true 3D; a camera-controls follow-cam frames
 * the field each frame (eased + zoom-capped); the DOM avatar cards and the metre /
 * gate labels are positioned by projecting their 3D world points to screen, so they
 * ride the road with crisp text and stay React-owned. All race→world math lives in
 * the pure povWorld / povFollowCam modules. three + camera-controls are
 * dynamic-imported so they only load when the POV mounts. See PovGrid.README.md.
 */
export default function PovGrid({ riderIds, riders, riderLive = {}, lapLengthM = 0, finishM = null, winCondition = 'distance' }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  // Start-line lineup (audit C5): EVERY non-DNF rider (incl. ghosts and not-yet-
  // moved riders parked at z=0) renders from mount, so the screen is never empty
  // at GO. The distM>0 filter now applies ONLY to camera framing, and only after
  // a start grace (see the rAF loop's framingMoved) — a stalled rider still can't
  // crush the scale mid-race, but the start line is always framed. DNF riders are
  // off the course entirely.
  const lineupIds = riderIds.filter((id) => !riderLive[id]?.dnf);
  const colorOf = (id) => LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length];
  // Fixed-screen-size rank + gap-to-next badge per card, mirroring the standings
  // tower (T8) off the SAME live `standings()` placement the container forwards.
  const badges = povBadges({ riderIds, riders, riderLive, winCondition });

  const rootRef = useRef(null);
  const glMountRef = useRef(null);
  const labelsRef = useRef(null);
  const markerEls = useRef({});           // { id: card DOM node }
  const badgeEls = useRef({});            // { id: fixed-size badge DOM node }
  const badgeSize = useRef({});           // { id: { text, w, h } } — see positionCards:
                                          // offsetWidth forces a reflow, so the badge box
                                          // is measured only when its text actually changes
                                          // (once per race tick), never per frame.
  const horizonChipRef = useRef(null);    // pinned "LEADER +N m" plate
  const chipShownRef = useRef(false);     // horizon-chip hysteresis state
  const sceneRef = useRef(null);          // built three.js scene + pools
  const tickRef = useRef({ riders: [], tickAt: 0 });
  const prevDistRef = useRef({});
  const gateCfgRef = useRef({ lapLengthM, finishM });
  gateCfgRef.current = { lapLengthM, finishM };
  const riderCountRef = useRef(0);
  riderCountRef.current = lineupIds.length;
  const logRef = useRef(null);
  if (!logRef.current) logRef.current = getLogger().child({ component: 'pov-grid' });

  // Capture each new data tick (only on real change) for the rAF loop to interpolate.
  // All non-DNF riders are captured — the unmoved ones sit at prev=cur=0 (z=0) on
  // the start line until they roll.
  useEffect(() => {
    const prev = prevDistRef.current;
    const changed = lineupIds.length !== Object.keys(prev).length
      || lineupIds.some((id) => prev[id] !== distOf(id));
    if (!changed) return;
    tickRef.current = {
      riders: lineupIds.map((id, idx) => ({
        id, idx,
        prev: Number.isFinite(prev[id]) ? prev[id] : distOf(id),
        cur: distOf(id),
        isGhost: !!riders[id]?.isGhost,
      })),
      tickAt: performance.now(),
    };
    const next = {};
    lineupIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // Build the three.js scene once, run the rAF loop. jsdom has no WebGL, so every
  // GL call is guarded: a missing context degrades to the avatar-only fallback.
  useEffect(() => {
    let alive = true;
    let raf = 0;
    const cleanupFns = [];

    (async () => {
      let THREE;
      let CameraControls;
      try {
        THREE = await import('three');
        CameraControls = (await import('camera-controls')).default;
      } catch (e) {
        logRef.current.error('cycle_game.pov.import_failed', { reason: String(e?.message || e) });
        sceneRef.current = { webgl: false };
        logRef.current.info('cycle_game.pov.mount', { riderCount: riderCountRef.current, webgl: false });
        return;
      }
      if (!alive) return;
      const glHost = glMountRef.current;
      const labelsHost = labelsRef.current;
      if (!glHost || !labelsHost) return;

      let renderer;
      try {
        CameraControls.install({ THREE });
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (e) {
        logRef.current.warn('cycle_game.pov.webgl_unavailable', { reason: String(e?.message || e) });
        sceneRef.current = { webgl: false };
        logRef.current.info('cycle_game.pov.mount', { riderCount: riderCountRef.current, webgl: false });
        return;
      }

      const rect = glHost.getBoundingClientRect();
      let W = Math.max(1, Math.round(rect.width));
      let H = Math.max(1, Math.round(rect.height));
      renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
      renderer.setSize(W, H, false);
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
      glHost.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(BG, MIN_DIST, FOG_FAR_M);
      const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 4000);
      const controls = new CameraControls(camera, renderer.domElement);
      controls.smoothTime = SMOOTH_TIME;
      controls.minDistance = MIN_DIST;
      controls.maxDistance = MAX_DIST;
      const NONE = CameraControls.ACTION.NONE;
      controls.mouseButtons.left = NONE; controls.mouseButtons.right = NONE;
      controls.mouseButtons.wheel = NONE; controls.mouseButtons.middle = NONE;
      controls.touches.one = NONE; controls.touches.two = NONE; controls.touches.three = NONE;

      // Ground-plane grid (shader): replaces both the rails and the metre trusses.
      const gridMat = new THREE.ShaderMaterial({
        uniforms: {
          uMinor: { value: GRID_MINOR_M }, uMajor: { value: GRID_MAJOR_M },
          uMinorColor: { value: new THREE.Color(GRID_MINOR_COLOR) },
          uMajorColor: { value: new THREE.Color(GRID_MAJOR_COLOR) },
          uFogNear: { value: MIN_DIST }, uFogFar: { value: FOG_FAR_M },
          uMinorFar: { value: MINOR_FADE_M }, uCamPos: { value: new THREE.Vector3() },
        },
        vertexShader: GRID_VERT, fragmentShader: GRID_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      gridMat.extensions = { derivatives: true }; // GL_OES_standard_derivatives (WebGL1 path)
      const gridGeom = new THREE.PlaneGeometry(2 * GRID_PLANE_HALF_W, GRID_PLANE_Z, 1, 1);
      const grid = new THREE.Mesh(gridGeom, gridMat);
      grid.rotation.x = -Math.PI / 2;                  // lay flat in the XZ plane
      grid.position.set(0, 0, 40 - GRID_PLANE_Z / 2);  // covers ~ +40 → -(GRID_PLANE_Z - 40)
      grid.frustumCulled = false;
      scene.add(grid);

      // Gate arches (pooled) + their labels.
      const archPts = [];
      const AN = 40;
      for (let i = 0; i <= AN; i++) {
        const a = Math.PI * (i / AN);
        archPts.push(-Math.cos(a) * ROAD_HALF_W, Math.sin(a) * ARCH_H, 0);
      }
      const archGeom = new THREE.BufferGeometry();
      archGeom.setAttribute('position', new THREE.Float32BufferAttribute(archPts, 3));
      const gatePool = [];
      for (let i = 0; i < GATE_POOL; i++) {
        const mat = new THREE.LineBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.85 });
        const line = new THREE.Line(archGeom, mat);
        line.frustumCulled = false;
        line.visible = false;
        scene.add(line);
        const labelEl = document.createElement('div');
        labelEl.className = 'cg-pov__gate-label';
        labelEl.style.opacity = '0';
        labelsHost.appendChild(labelEl);
        gatePool.push({ line, mat, labelEl });
      }

      // Off-road major metre labels (pooled DOM, projected each frame).
      const majorLabelPool = [];
      for (let i = 0; i < MAJOR_LABEL_POOL; i++) {
        const el = document.createElement('div');
        el.className = 'cg-pov__mark-label';
        el.style.opacity = '0';
        labelsHost.appendChild(el);
        majorLabelPool.push(el);
      }

      const s = {
        THREE, renderer, scene, camera, controls,
        gridMat, gridGeom, gatePool, majorLabelPool,
        webgl: true, W, H,
        _v: new THREE.Vector3(), _cs: new THREE.Vector3(),
      };
      sceneRef.current = s;

      const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
        const r = glHost.getBoundingClientRect();
        s.W = Math.max(1, Math.round(r.width));
        s.H = Math.max(1, Math.round(r.height));
        renderer.setSize(s.W, s.H, false);
        camera.aspect = s.W / s.H;
        camera.updateProjectionMatrix();
      }) : null;
      if (ro) { ro.observe(glHost); cleanupFns.push(() => ro.disconnect()); }

      logRef.current.info('cycle_game.pov.mount', { riderCount: riderCountRef.current, webgl: true });

      // --- per-frame helpers (close over s) ---
      const screenOf = (x, y, z) => {
        s._cs.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        const inFront = s._cs.z < 0;             // camera looks down its own -z
        const dist = -s._cs.z;
        s._v.set(x, y, z).project(camera);
        return { sx: (s._v.x * 0.5 + 0.5) * s.W, sy: (-s._v.y * 0.5 + 0.5) * s.H, inFront, dist };
      };

      const updateMajorLabels = (marks, fogFar) => {
        let li = 0;
        for (let i = 0; i < marks.length && li < majorLabelPool.length; i++) {
          if (!marks[i].major) continue;
          const m = marks[i];
          const el = majorLabelPool[li++];
          const p = screenOf(-ROAD_HALF_W - 0.8, 0, m.z);
          if (!p.inFront) { el.style.opacity = '0'; continue; }
          el.textContent = m.label;
          el.style.opacity = clamp(0.15, 0.85, 1 - p.dist / fogFar).toFixed(3);
          el.style.transform = `translate(-50%,-50%) translate(${p.sx.toFixed(1)}px,${p.sy.toFixed(1)}px)`;
        }
        for (; li < majorLabelPool.length; li++) majorLabelPool[li].style.opacity = '0';
      };

      const updateGates = (gates, fogFar) => {
        for (let i = 0; i < gatePool.length; i++) {
          const g = gatePool[i];
          const data = gates[i];
          if (!data) { g.line.visible = false; g.labelEl.style.opacity = '0'; continue; }
          g.line.visible = true;
          g.line.position.set(0, 0, data.z);
          g.mat.color.setHex(data.isFinish ? GOLD : MAGENTA);
          g.mat.opacity = data.isFinish ? 0.95 : 0.8;
          const p = screenOf(0, ARCH_H * 0.62, data.z);
          if (!p.inFront) { g.labelEl.style.opacity = '0'; continue; }
          g.labelEl.textContent = data.label;
          g.labelEl.style.color = data.isFinish ? '#ffd66e' : '#ff7ac4';
          g.labelEl.style.opacity = clamp(0.2, 1, 1 - p.dist / fogFar).toFixed(3);
          g.labelEl.style.transform = `translate(-50%,-50%) translate(${p.sx.toFixed(1)}px,${p.sy.toFixed(1)}px)`;
        }
      };

      // Cards ride the road (depth-scaled avatars); their rank/gap badges are
      // pinned just below at a FIXED screen size (counter to depth) so the "who
      // am I chasing" readout is legible even for a tiny, far, compressed leader.
      const positionCards = (worldRiders, fogFar) => {
        // Pass 1 — project every card, and collect each badge's would-be box.
        const boxes = [];
        worldRiders.forEach((r) => {
          const el = markerEls.current[r.id];
          const badgeEl = badgeEls.current[r.id];
          const p = screenOf(r.x, 0, r.z);
          if (!p.inFront) {
            if (el) el.style.opacity = '0';
            if (badgeEl) badgeEl.style.opacity = '0';
            return;
          }
          const scale = clamp(CARD_MIN_SCALE, CARD_MAX_SCALE, CARD_FOCAL / Math.max(1, p.dist));
          const z = String(10000 - Math.round(p.dist)); // nearer on top
          if (el) {
            el.style.opacity = '1';
            el.style.transform = `translate(${p.sx.toFixed(1)}px,${p.sy.toFixed(1)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
            el.style.zIndex = z;
          }
          if (badgeEl) {
            const belowPx = 44 * scale + 10; // avatar half-height at this scale + gap
            badgeEl.style.opacity = clamp(0.6, 1, 1 - p.dist / fogFar).toFixed(3);
            badgeEl.style.zIndex = z;
            const text = badgeEl.textContent;
            const cached = badgeSize.current[r.id];
            if (!cached || cached.text !== text) {
              badgeSize.current[r.id] = { text, w: badgeEl.offsetWidth, h: badgeEl.offsetHeight };
            }
            const { w, h } = badgeSize.current[r.id];
            boxes.push({ el: badgeEl, x: p.sx, y: p.sy + belowPx, w, h, dist: p.dist });
          }
        });

        // Pass 2 — de-collide in screen space (pure, unit-tested in povWorld).
        resolveBadgeStack(boxes, BADGE_STACK_GAP_PX).forEach((b) => {
          b.el.style.transform = `translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px) translate(-50%,0)`;
        });
      };

      // Horizon "LEADER +N m" chip: fixed-size, pinned high-centre, shown (with
      // hysteresis) only when the TRUE gap outruns the compressed near window.
      const updateHorizonChip = (leaderM, lastM) => {
        const chip = horizonChipRef.current;
        if (!chip) return;
        const st = horizonChipState({
          gapM: Math.max(0, leaderM - lastM), wasShown: chipShownRef.current, showAtM: HORIZON_SHOW_M,
        });
        chipShownRef.current = st.show;
        if (st.show) { chip.textContent = st.text; chip.style.opacity = '1'; }
        else { chip.style.opacity = '0'; }
      };

      // Compute the pure world for a tick + fraction (shared by the initial frame
      // and the rAF loop). `framingMoved` gates the not-yet-moved-rider exclusion.
      const worldAt = (t, now, framingMoved) => povWorld({
        riders: t.riders, frac: tickFraction(now, t.tickAt, RACE_TICK_MS), laneCount: t.riders.length,
        lapLengthM: gateCfgRef.current.lapLengthM, finishM: gateCfgRef.current.finishM,
        aheadM: AHEAD_M, behindM: BEHIND_M, gridMinorM: GRID_MINOR_M, gridMajorM: LABEL_MAJOR_M,
        roadHalfW: ROAD_HALF_W, laneInset: LANE_INSET, framingMoved,
      });

      // Initial framing so the FIRST rendered frame is already framed (no
      // unframed pop-in from the origin) — start-line lineup framed as a whole.
      const startAt = performance.now();
      const w0 = worldAt(tickRef.current, startAt, false);
      if (w0.riders.length) {
        const b = povFollowCam({ leaderZ: w0.leaderZ, lastZ: w0.lastZ, aheadM: AHEAD_M, minSpanM: MIN_SPAN_M, roadHalfW: ROAD_HALF_W });
        const span = b.max.z - b.min.z;
        const camDist = clamp(MIN_DIST, MAX_DIST, span * CAM_FILL);
        controls.setLookAt(0, camDist * CAM_ELEV, b.max.z + camDist * CAM_BEHIND, 0, 0, b.min.z + span * LOOK_AHEAD, false);
        controls.update(0);
      }

      // --- rAF loop ---
      let last = performance.now();
      let lastCamLog = 0;
      // Frame-pacing forensics: "it looked janky" reports need numbers. The GL
      // draw loop runs continuously during a race, so its inter-frame gaps ARE
      // the screen's pacing. Logged ~every 30s at info (survives to the session
      // JSONL, unlike the debug camera trace).
      let paceWindowStart = performance.now();
      let paceFrames = 0;
      let paceMaxGapMs = 0;
      const draw = () => {
        if (!alive) return;
        const now = performance.now();
        const dt = Math.min(0.064, (now - last) / 1000);
        paceFrames += 1;
        paceMaxGapMs = Math.max(paceMaxGapMs, now - last);
        last = now;
        const t = tickRef.current;
        // Frame moved riders only once the start grace has elapsed — before that,
        // frame the whole start line so GO isn't an empty road.
        const framingMoved = now - startAt > GRACE_MS;
        const world = worldAt(t, now, framingMoved);

        // Scale fog UP to always cover the (compressed) leader, so a big-gap
        // leader stays a visible card, never a fog silhouette (audit C5 §6).
        const leaderDist = Math.hypot(camera.position.x, camera.position.y, camera.position.z - world.leaderZ);
        const fogFar = Math.max(FOG_FAR_M, leaderDist + 60);
        scene.fog.far = fogFar;
        gridMat.uniforms.uFogFar.value = fogFar;

        updateGates(world.gates, fogFar);

        if (world.riders.length) {
          const b = povFollowCam({
            leaderZ: world.leaderZ, lastZ: world.lastZ,
            aheadM: AHEAD_M, minSpanM: MIN_SPAN_M, roadHalfW: ROAD_HALF_W,
          });
          const zNear = b.max.z;            // last place (least negative)
          const zFar = b.min.z;             // ahead of leader (most negative)
          const span = zNear - zFar;
          const camDist = clamp(MIN_DIST, MAX_DIST, span * CAM_FILL);
          const tgtZ = zFar + span * LOOK_AHEAD; // look high up the road
          const camZ = zNear + camDist * CAM_BEHIND;
          const camY = camDist * CAM_ELEV;
          controls.setLookAt(0, camY, camZ, 0, 0, tgtZ, true);
        }
        controls.update(dt);
        gridMat.uniforms.uCamPos.value.copy(camera.position); // fog fade is camera-relative
        renderer.render(scene, camera);

        updateMajorLabels(world.marks, fogFar);
        positionCards(world.riders, fogFar);
        updateHorizonChip(world.leaderM, world.lastM);

        if (world.riders.length && now - lastCamLog >= 1000) {
          lastCamLog = now;
          controls.getTarget(s._cs);
          // sampled → persists at info (rate-limited + aggregated) so camera
          // framing disputes ("the leader vanished") are corroborable from the
          // session JSONL without flipping the kiosk to debug.
          logRef.current.sampled?.('cycle_game.pov.camera', {
            camX: +camera.position.x.toFixed(1), camY: +camera.position.y.toFixed(1), camZ: +camera.position.z.toFixed(1),
            tgtX: +s._cs.x.toFixed(1), tgtY: +s._cs.y.toFixed(1), tgtZ: +s._cs.z.toFixed(1),
            distance: +controls.distance.toFixed(1), fov: camera.fov,
            leaderDistM: Math.round(-world.leaderZ), riderCount: world.riders.length,
          }, { maxPerMinute: 6, aggregate: true });
        }
        // ~30s pacing snapshot: fps + the worst frame gap in the window. A
        // healthy kiosk reads ~60fps / gap <50ms; jank reports should show up
        // as sub-30 fps or 100ms+ gaps here.
        if (now - paceWindowStart >= 30000) {
          const fps = Math.round((paceFrames * 1000) / (now - paceWindowStart));
          logRef.current.info('cycle_game.render_pacing', {
            fps, maxFrameGapMs: Math.round(paceMaxGapMs), riderCount: world.riders.length,
          });
          paceWindowStart = now;
          paceFrames = 0;
          paceMaxGapMs = 0;
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      cleanupFns.push(() => cancelAnimationFrame(raf));
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cleanupFns.forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
      const s = sceneRef.current;
      if (s && s.webgl) {
        try { s.controls.dispose(); } catch (e) { /* noop */ }
        try { s.gridGeom.dispose(); s.gridMat.dispose(); } catch (e) { /* noop */ }
        try { s.renderer.dispose(); } catch (e) { /* noop */ }
        try {
          const el = s.renderer.domElement;
          if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (e) { /* noop */ }
        try { s.gatePool.forEach((g) => { if (g.labelEl.parentNode) g.labelEl.parentNode.removeChild(g.labelEl); }); } catch (e) { /* noop */ }
        try { s.majorLabelPool.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); }); } catch (e) { /* noop */ }
      }
      logRef.current.info('cycle_game.pov.unmount', {});
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="cg-pov" data-testid="race-pov" ref={rootRef}>
      <div className="cg-pov__gl" ref={glMountRef} aria-hidden="true" />
      <div className="cg-pov__labels" ref={labelsRef} aria-hidden="true" />
      <div className="cg-pov__cards" aria-hidden="true">
        {lineupIds.map((id) => {
          const color = colorOf(id);
          const isGhost = !!riders[id]?.isGhost;
          const live = riderLive[id] || {};
          return (
            <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost cg-ghost' : ''}`} data-testid="pov-marker"
              ref={(el) => { markerEls.current[id] = el; }} style={{ '--cg-pov-color': color }}>
              <CircularUserAvatar name={riders[id]?.displayName} avatarSrc={live.avatarSrc}
                heartRate={live.heartRate} zoneId={live.zoneId} zoneColor={live.zoneColor || color}
                size={88} showGauge={false} showIndicator={false} />
            </div>
          );
        })}
      </div>
      {/* Fixed-screen-size rank + gap-to-next badges (not depth-scaled), pinned
          below each card by the rAF loop. Rank/gap mirror the standings tower. */}
      <div className="cg-pov__badges" aria-hidden="true">
        {lineupIds.map((id) => (
          <div key={id} className={`cg-pov__badge${riders[id]?.isGhost ? ' is-ghost' : ''}`} data-testid="pov-badge"
            data-rider={id} ref={(el) => { badgeEls.current[id] = el; }}
            style={{ '--cg-pov-color': colorOf(id), opacity: 0 }}>
            {badges[id]?.text || ''}
          </div>
        ))}
      </div>
      {/* Horizon leader chip — pinned high-centre, shown only when the true gap
          outruns the compressed near window (audit C5). */}
      <div className="cg-pov__horizon-chip" data-testid="pov-horizon-chip"
        ref={horizonChipRef} style={{ opacity: 0 }} aria-hidden="true" />
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object,
  lapLengthM: PropTypes.number,
  finishM: PropTypes.number,
  winCondition: PropTypes.string,
};
