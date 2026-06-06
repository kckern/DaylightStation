import { projectX, projectY } from './povCamera.js';

const CYAN = '33, 230, 255'; // #21e6ff

// Dual-pass neon stroke: a wide faint halo + a narrow bright core. Cheaper than
// shadowBlur at 60fps on the Shield, and reads as glow.
function neonLine(ctx, x0, y0, x1, y1, alpha, width) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.lineWidth = width * 3.5;
  ctx.strokeStyle = `rgba(${CYAN}, ${(alpha * 0.35).toFixed(3)})`;
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = `rgba(${CYAN}, ${alpha.toFixed(3)})`;
  ctx.stroke();
}

/**
 * Draw the POV road wireframe onto a 2D context for one frame.
 *  - rails: the fixed longitudinal gridlines (near-edge x in `railsX`), each
 *    projected near(t=0,bottom) → far(t=1,horizon) through the live camera.
 *  - trusses: the metre marks (`lineSlots` from computePovFrame), each a
 *    horizontal line across the road width at its depth, fogged by its opacity.
 * Positions are CSS px; the caller scales the context by devicePixelRatio.
 *
 * @param {CanvasRenderingContext2D|null} ctx
 * @param {{camera:object, lineSlots:Array, railsX:number[], dims:{w:number,h:number}}} args
 */
export function drawScene(ctx, { camera, lineSlots = [], railsX = [], dims }) {
  const w = dims?.w || 0;
  const h = dims?.h || 0;
  if (!ctx || !(w > 0) || !(h > 0)) return;

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  const X = (frac) => (frac / 100) * w;  // x fraction (0..100) → px
  const Y = (frac) => frac * h;          // y fraction (0..1)   → px

  // Rails — longitudinal, faint, uniform (the road's lane grid).
  const railY0 = Y(projectY(0, camera));
  const railY1 = Y(projectY(1, camera));
  for (const nx of railsX) {
    neonLine(ctx, X(projectX(0, nx, camera)), railY0, X(projectX(1, nx, camera)), railY1, 0.30, 1);
  }

  // Trusses — lateral metre marks bunching to the horizon, fogged by depth.
  const vanishX = Number.isFinite(camera?.vanishX) ? camera.vanishX : 50;
  for (const s of lineSlots) {
    if (!(s.opacity > 0)) continue;
    const y = Y(s.y);
    const xl = X(vanishX + (0 - vanishX) * s.scale);
    const xr = X(vanishX + (100 - vanishX) * s.scale);
    const alpha = s.opacity * (s.major ? 0.95 : 0.45);
    neonLine(ctx, xl, y, xr, y, alpha, s.major ? 1.6 : 1);
  }
}

export default drawScene;
