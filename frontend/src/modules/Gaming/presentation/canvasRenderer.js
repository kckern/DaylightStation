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

async function loadPlanImages(catalog, plan, resolveAssetUrl) {
  const images = new Map();
  await Promise.all([...new Set(plan.commands.filter((command) => command.type === 'sprite').map((command) => command.asset))].map(async (assetId) => {
    const image = new Image(); image.decoding = 'async'; image.src = resolveAssetUrl(assetId, catalog.assets[assetId]);
    await image.decode(); images.set(assetId, image);
  }));
  return images;
}

/** Execute the same renderer-neutral plan used by the Node PNG renderer. */
export async function drawScenePlanToCanvas(canvas, catalog, plan, {
  resolveAssetUrl = (_assetId, asset) => asset.image_url,
} = {}) {
  const scale = plan.pixel_scale;
  canvas.width = plan.logical_size[0] * scale; canvas.height = plan.logical_size[1] * scale;
  const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
  context.fillStyle = plan.background; context.fillRect(0, 0, canvas.width, canvas.height);
  const images = await loadPlanImages(catalog, plan, resolveAssetUrl); const normalizedFrames = new Map();
  for (const command of plan.commands) {
    if (command.type === 'shadow') {
      context.save(); context.globalAlpha = command.opacity; context.fillStyle = command.color; context.beginPath();
      context.ellipse(command.at[0] * scale, command.at[1] * scale, command.size[0] * scale / 2, command.size[1] * scale / 2, 0, 0, Math.PI * 2); context.fill(); context.restore();
      continue;
    }
    const asset = catalog.assets[command.asset]; const frame = asset.frames[command.frame]; const [sx, sy, sw, sh] = sourceRect(asset, frame, command.source_cell_offset);
    const densityScale = scale / asset.pixel_density; const dw = sw * densityScale; const dh = sh * densityScale;
    const [ax, ay] = anchorOffset(frame.anchor ?? asset.defaults?.anchor, dw, dh, densityScale);
    let sourceImage = images.get(command.asset); let sourceX = sx; let sourceY = sy; let sourceWidth = sw; let sourceHeight = sh;
    if (asset.pixel_density > 1) {
      const key = `${command.asset}#${command.frame}:${command.source_cell_offset.join(',')}`;
      if (!normalizedFrames.has(key)) {
        const normalized = document.createElement('canvas'); normalized.width = sw / asset.pixel_density; normalized.height = sh / asset.pixel_density;
        const normalizedContext = normalized.getContext('2d'); normalizedContext.imageSmoothingEnabled = false;
        normalizedContext.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, normalized.width, normalized.height); normalizedFrames.set(key, normalized);
      }
      sourceImage = normalizedFrames.get(key); sourceX = 0; sourceY = 0; sourceWidth = sourceImage.width; sourceHeight = sourceImage.height;
    }
    context.save(); context.globalAlpha = command.opacity; context.translate(command.at[0] * scale, command.at[1] * scale);
    context.rotate(command.rotation * Math.PI / 180); context.scale(command.flip_x ? -1 : 1, 1);
    context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, -ax, -ay, dw, dh); context.restore();
  }
  return { width: canvas.width, height: canvas.height, plan_hash: plan.hash, draws: plan.commands.length };
}
