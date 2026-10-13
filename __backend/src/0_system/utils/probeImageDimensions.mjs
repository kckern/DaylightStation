import imageSize from 'image-size';

/**
 * Probes an image URL to determine its dimensions without downloading the full file.
 * Streams up to 128 KB, then uses image-size to parse width/height from the header bytes.
 *
 * @param {string} url - The image URL to probe
 * @param {number} [timeoutMs=3000] - Timeout in milliseconds
 * @returns {Promise<{width: number, height: number}|null>} Dimensions or null on failure
 */
export async function probeImageDimensions(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaylightStation/1.0)' },
    });
    if (!res.ok) return null;

    const MAX_BYTES = 128 * 1024;
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of res.body) {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes >= MAX_BYTES) break;
    }

    controller.abort();

    const buffer = Buffer.concat(chunks, totalBytes);
    const result = imageSize(buffer);
    if (result?.width && result?.height) {
      return { width: result.width, height: result.height };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
