import { PRESENTATION_RENDER_PASSES } from '@shared-presentation/index.mjs';

function sourceRect(asset, frame, sourceCellOffset = [0, 0]) {
  if (frame.rect) return frame.rect;
  const [cellWidth, cellHeight] = asset.geometry.cell;
  return [(frame.cell[0] + sourceCellOffset[0]) * cellWidth, (frame.cell[1] + sourceCellOffset[1]) * cellHeight, cellWidth, cellHeight];
}

function anchorOffset(anchor, width, height, densityScale) {
  if (Array.isArray(anchor?.point)) return anchor.point.map((value) => value * densityScale);
  const points = {
    'top-left': [0, 0], 'top-center': [width / 2, 0], 'top-right': [width, 0],
    'center-left': [0, height / 2], center: [width / 2, height / 2], 'center-right': [width, height / 2],
    'bottom-left': [0, height], 'bottom-center': [width / 2, height], 'bottom-right': [width, height],
  };
  return points[anchor] ?? points['top-left'];
}

export function sortSceneCommands(commands) {
  return commands.map((command, index) => ({ command, index })).sort((left, right) => {
    const leftPass = PRESENTATION_RENDER_PASSES[left.command.render_layer] ?? 999;
    const rightPass = PRESENTATION_RENDER_PASSES[right.command.render_layer] ?? 999;
    return leftPass - rightPass || (left.command.sort_y ?? -1) - (right.command.sort_y ?? -1) || left.index - right.index;
  }).map(({ command }) => command);
}

/**
 * Stateful Canvas executor used by interactive surfaces. Images and normalized
 * high-density frames are cached across animation ticks; callers supply only
 * renderer-neutral draw commands.
 */
export function createCanvasSceneRenderer(canvas, catalog, {
  resolveAssetUrl = (_assetId, asset) => asset.image_url,
} = {}) {
  const context = canvas.getContext('2d');
  const frameCanvas = canvas.ownerDocument?.createElement?.('canvas') ?? null; const frameContext = frameCanvas?.getContext?.('2d') ?? null;
  const images = new Map(); const normalizedFrames = new Map(); let disposed = false;

  const loadAsset = async (assetId) => {
    if (images.has(assetId)) return images.get(assetId);
    const asset = catalog.assets?.[assetId];
    if (!asset) throw new Error(`Canvas command references unknown asset ${assetId}`);
    const promise = new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = 'async'; image.src = resolveAssetUrl(assetId, asset);
      const complete = () => resolve(image); const fail = () => reject(new Error(`Unable to decode presentation asset ${assetId}`));
      if (typeof image.decode === 'function') image.decode().then(complete, fail);
      else { image.onload = complete; image.onerror = fail; }
    });
    images.set(assetId, promise);
    try { const image = await promise; images.set(assetId, image); return image; } catch (error) { images.delete(assetId); throw error; }
  };

  const ensureAssets = async (commands) => {
    const ids = [...new Set(commands.filter((command) => command.type === 'sprite').map((command) => command.asset))];
    await Promise.all(ids.map(loadAsset));
  };

  const drawCommand = (command, scale, targetContext = context) => {
    if (command.type === 'fill') {
      targetContext.save();
      if (command.clip_polygon) {
        targetContext.beginPath(); command.clip_polygon.forEach(([x, y], index) => targetContext[index ? 'lineTo' : 'moveTo']((command.at[0] + x) * scale, (command.at[1] + y) * scale));
        targetContext.closePath(); targetContext.clip();
      }
      targetContext.globalAlpha = command.opacity; targetContext.fillStyle = command.color;
      targetContext.fillRect(command.at[0] * scale, command.at[1] * scale, command.size[0] * scale, command.size[1] * scale); targetContext.restore(); return;
    }
    if (command.type === 'shadow') {
      targetContext.save(); targetContext.globalAlpha = command.opacity; targetContext.fillStyle = command.color; targetContext.beginPath();
      targetContext.ellipse(command.at[0] * scale, command.at[1] * scale, command.size[0] * scale / 2, command.size[1] * scale / 2, 0, 0, Math.PI * 2); targetContext.fill(); targetContext.restore(); return;
    }
    const asset = catalog.assets[command.asset]; const frame = asset?.frames?.[command.frame];
    if (!frame) throw new Error(`Canvas command references unknown frame ${command.asset}#${command.frame}`);
    if (frame.transparent) return;
    const offset = command.source_cell_offset ?? [0, 0]; const [sx, sy, sw, sh] = sourceRect(asset, frame, offset);
    const densityScale = scale / asset.pixel_density; const dw = sw * densityScale; const dh = sh * densityScale;
    const [ax, ay] = anchorOffset(frame.anchor ?? asset.defaults?.anchor, dw, dh, densityScale);
    let sourceImage = images.get(command.asset); let sourceX = sx; let sourceY = sy; let sourceWidth = sw; let sourceHeight = sh;
    if (asset.pixel_density > 1) {
      const key = `${command.asset}#${command.frame}:${offset.join(',')}`;
      if (!normalizedFrames.has(key)) {
        const normalized = document.createElement('canvas'); normalized.width = sw / asset.pixel_density; normalized.height = sh / asset.pixel_density;
        const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
        normalizedContext.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, normalized.width, normalized.height); normalizedFrames.set(key, normalized);
      }
      sourceImage = normalizedFrames.get(key); sourceX = 0; sourceY = 0; sourceWidth = sourceImage.width; sourceHeight = sourceImage.height;
    }
    targetContext.save();
    if (command.clip_polygon) {
      targetContext.beginPath(); command.clip_polygon.forEach(([x, y], index) => targetContext[index ? 'lineTo' : 'moveTo']((command.at[0] + x) * scale, (command.at[1] + y) * scale));
      targetContext.closePath(); targetContext.clip();
    }
    targetContext.globalAlpha = command.opacity ?? 1; targetContext.translate(command.at[0] * scale, command.at[1] * scale);
    targetContext.rotate((command.rotation ?? 0) * Math.PI / 180); targetContext.scale(command.flip_x ? -1 : 1, 1);
    targetContext.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, -ax, -ay, dw, dh); targetContext.restore();
  };

  const draw = async (plan, { commands = plan.commands, overlays = [], showGrid = false, selectedCommand = null } = {}) => {
    if (disposed) throw new Error('Canvas scene renderer is disposed');
    const merged = overlays.length ? sortSceneCommands([...commands, ...overlays]) : commands;
    await ensureAssets(merged);
    const scale = plan.pixel_scale; const width = plan.logical_size[0] * scale; const height = plan.logical_size[1] * scale;
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    if (frameCanvas) { if (frameCanvas.width !== width) frameCanvas.width = width; if (frameCanvas.height !== height) frameCanvas.height = height; }
    const drawContext = frameContext ?? context;
    drawContext.imageSmoothingEnabled = false; drawContext.clearRect?.(0, 0, width, height);
    drawContext.fillStyle = plan.background; drawContext.fillRect(0, 0, width, height);
    for (const command of merged) drawCommand(command, scale, drawContext);
    if (showGrid) {
      drawContext.save(); drawContext.strokeStyle = 'rgba(255,255,255,.16)'; drawContext.lineWidth = 1;
      for (let x = 0; x <= plan.logical_size[0]; x += plan.grid.cell[0]) { drawContext.beginPath(); drawContext.moveTo(x * scale + 0.5, 0); drawContext.lineTo(x * scale + 0.5, height); drawContext.stroke(); }
      for (let y = 0; y <= plan.logical_size[1]; y += plan.grid.cell[1]) { drawContext.beginPath(); drawContext.moveTo(0, y * scale + 0.5); drawContext.lineTo(width, y * scale + 0.5); drawContext.stroke(); }
      drawContext.restore();
    }
    if (selectedCommand?.at) {
      drawContext.save(); drawContext.strokeStyle = '#ffe66d'; drawContext.lineWidth = Math.max(1, scale); drawContext.strokeRect((selectedCommand.at[0] - 8) * scale, (selectedCommand.at[1] - 16) * scale, 16 * scale, 16 * scale); drawContext.restore();
    }
    if (frameContext) { context.imageSmoothingEnabled = false; context.clearRect?.(0, 0, width, height); context.drawImage(frameCanvas, 0, 0); }
    return { width, height, plan_hash: plan.hash, draws: merged.length };
  };

  return Object.freeze({ draw, preload: ensureAssets, dispose() { disposed = true; images.clear(); normalizedFrames.clear(); } });
}

/** Execute a renderer-neutral plan once; interactive clients should reuse createCanvasSceneRenderer. */
export async function drawScenePlanToCanvas(canvas, catalog, plan, options = {}) {
  const renderer = createCanvasSceneRenderer(canvas, catalog, options); const report = await renderer.draw(plan); renderer.dispose(); return report;
}
