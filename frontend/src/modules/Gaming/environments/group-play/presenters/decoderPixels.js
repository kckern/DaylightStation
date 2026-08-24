export function normalizeMaskPixels(imageData) {
  const histogram = new Uint32Array(256); const pixels = imageData.data; let count = 0; let total = 0;
  for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] === 0) continue; const luminance = Math.round(.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]); histogram[luminance] += 1; count += 1; total += luminance; }
  let backgroundWeight = 0; let backgroundSum = 0; let best = -1; let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value]; if (!backgroundWeight) continue; const foregroundWeight = count - backgroundWeight; if (!foregroundWeight) break;
    backgroundSum += value * histogram[value]; const meanBackground = backgroundSum / backgroundWeight; const meanForeground = (total - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (variance > best) { best = variance; threshold = value; }
  }
  const output = typeof ImageData === 'function'
    ? new ImageData(imageData.width, imageData.height)
    : { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(pixels.length) };
  for (let i = 0; i < pixels.length; i += 4) { const luminance = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]; const value = luminance > threshold ? 255 : 0; output.data[i] = value; output.data[i + 1] = value; output.data[i + 2] = value; output.data[i + 3] = pixels[i + 3]; }
  return output;
}
