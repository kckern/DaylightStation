import { projectX, projectY } from './povCamera.js';

const CYAN = '33, 230, 255';     // #21e6ff — the road grid
const MAGENTA = '255, 64, 160';  // lap gates (milestone accent)
const GOLD = '255, 200, 70';     // the finish gate

// Dual-pass neon: a wide faint halo + a narrow bright core. Cheaper than shadowBlur
// at 60fps on the Shield, and reads as glow. `buildPath` re-issues the path for each
// pass (stroke() consumes nothing, but lineWidth differs per pass).
function neonStroke(ctx, buildPath, rgb, alpha, width) {
  buildPath();
  ctx.lineWidth = width * 3.5;
  ctx.strokeStyle = `rgba(${rgb}, ${(alpha * 0.35).toFixed(3)})`;
  ctx.stroke();
  buildPath();
  ctx.lineWidth = width;
  ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
  ctx.stroke();
}

const linePath = (ctx, x0, y0, x1, y1) => () => {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
};

/**
 * Draw the POV road wireframe onto a 2D context for one frame.
 *  - rails: the fixed longitudinal gridlines (near-edge x in `railsX`).
 *  - trusses: the metre marks (`lineSlots`), horizontal across the road, fogged.
 *  - gates: lap-arch slots (`gates`), drawn as a curved arch over the road with a
 *    "LAP N" / "FINISH" label, magenta (gold for the finish), fogged by opacity.
 * Positions are CSS px; the caller scales the context by devicePixelRatio.
 *
 * @param {CanvasRenderingContext2D|null} ctx
 * @param {{camera:object, lineSlots:Array, railsX:number[], gates?:Array, dims:{w:number,h:number}}} args
 */
export function drawScene(ctx, { camera, lineSlots = [], railsX = [], gates = [], dims }) {
  const w = dims?.w || 0;
  const h = dims?.h || 0;
  if (!ctx || !(w > 0) || !(h > 0)) return;

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  const X = (frac) => (frac / 100) * w;  // x fraction (0..100) → px
  const Y = (frac) => frac * h;          // y fraction (0..1)   → px
  const vanishX = Number.isFinite(camera?.vanishX) ? camera.vanishX : 50;

  // Rails — longitudinal, faint, uniform (the road's lane grid).
  const railY0 = Y(projectY(0, camera));
  const railY1 = Y(projectY(1, camera));
  for (const nx of railsX) {
    neonStroke(ctx, linePath(ctx, X(projectX(0, nx, camera)), railY0, X(projectX(1, nx, camera)), railY1), CYAN, 0.30, 1);
  }

  // Trusses — lateral metre marks bunching to the horizon, fogged by depth.
  // Each major line is labeled with its metre value just off the road's left edge.
  for (const s of lineSlots) {
    if (!(s.opacity > 0)) continue;
    const y = Y(s.y);
    const xl = X(vanishX + (0 - vanishX) * s.scale);
    const xr = X(vanishX + (100 - vanishX) * s.scale);
    const alpha = s.opacity * (s.major ? 0.95 : 0.45);
    neonStroke(ctx, linePath(ctx, xl, y, xr, y, alpha), CYAN, alpha, s.major ? 1.6 : 1);
    if (s.major) {
      const fontPx = Math.max(7, Math.round(13 * s.scale));
      ctx.font = `600 ${fontPx}px "Roboto Mono", ui-monospace, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${CYAN}, ${(alpha * 0.85).toFixed(3)})`;
      ctx.fillText(`${Math.round(s.m)}m`, xl - 4 - 6 * s.scale, y); // off-course, left of the road edge
    }
  }

  // Lap gates — a curved arch over the road, with a label, at each lap mark.
  for (const g of gates) {
    if (!(g.opacity > 0)) continue;
    drawGate(ctx, g, { X, Y, camera, vanishX });
  }
}

// One lap-gate arch: posts at the road edges + a curved top span, plus the label.
function drawGate(ctx, g, { X, Y, camera, vanishX }) {
  const rgb = g.isFinish ? GOLD : MAGENTA;
  const yRoad = Y(g.y);
  const left = X(projectX(g.t, 0, camera));
  const right = X(projectX(g.t, 100, camera));
  const roadW = Math.abs(right - left);
  const archH = roadW * 0.55;             // post height ∝ road width (consistent arch)
  const yTop = yRoad - archH;
  const midX = (left + right) / 2;
  const yCtrl = yTop - roadW * 0.22;      // top-curve bulge
  const alpha = Math.max(0, Math.min(1, g.opacity));
  const width = Math.max(1, 2.4 * g.scale);

  // posts + curved lintel, one path
  neonStroke(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(left, yRoad);
    ctx.lineTo(left, yTop);
    ctx.quadraticCurveTo(midX, yCtrl, right, yTop);
    ctx.lineTo(right, yRoad);
  }, rgb, alpha * 0.9, width);

  // label
  const fontPx = Math.max(8, Math.round(18 * g.scale));
  const label = g.isFinish ? 'FINISH' : `LAP ${g.lap}`;
  ctx.font = `700 ${fontPx}px "Roboto Condensed", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
  ctx.fillText(label, midX, yCtrl - 2);
}

export default drawScene;
