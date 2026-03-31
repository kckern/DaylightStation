import sharp from 'sharp';

const THUMB_WIDTH = 300;
const LABEL_SIZE = 40;

export async function makeThumbnail(imageBuffer, width = THUMB_WIDTH) {
  return sharp(imageBuffer)
    .resize(width)
    .png()
    .toBuffer();
}

export async function addPageLabel(thumbBuffer, pageNum) {
  const label = Buffer.from(
    `<svg width="${LABEL_SIZE}" height="${LABEL_SIZE}">
      <rect width="${LABEL_SIZE}" height="${LABEL_SIZE}" rx="4" fill="rgba(0,0,0,0.7)"/>
      <text x="${LABEL_SIZE / 2}" y="${LABEL_SIZE * 0.72}" text-anchor="middle"
        font-family="sans-serif" font-size="22" font-weight="bold"
        fill="white">${pageNum}</text>
    </svg>`
  );
  return sharp(thumbBuffer)
    .composite([{ input: label, gravity: 'southeast' }])
    .png()
    .toBuffer();
}

export async function buildContactSheet(thumbnails, { columns = 5, padding = 4 } = {}) {
  if (thumbnails.length === 0) throw new Error('No thumbnails to stitch');

  const firstMeta = await sharp(thumbnails[0]).metadata();
  const cellW = firstMeta.width;
  const cellH = firstMeta.height;

  const rows = Math.ceil(thumbnails.length / columns);
  const totalW = columns * cellW + (columns - 1) * padding;
  const totalH = rows * cellH + (rows - 1) * padding;

  const composites = thumbnails.map((buf, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    return {
      input: buf,
      left: col * (cellW + padding),
      top: row * (cellH + padding),
    };
  });

  return sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function rotateImage(imageBuffer, degrees) {
  return sharp(imageBuffer)
    .rotate(degrees)
    .jpeg()
    .toBuffer();
}

export function issueToRotation(issue) {
  const map = {
    upside_down: 180,
    sideways_right: 90,
    sideways_left: 270,
  };
  return map[issue] ?? null;
}
