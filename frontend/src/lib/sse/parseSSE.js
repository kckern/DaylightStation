/**
 * Async-generator over a `ReadableStream<Uint8Array>` that yields parsed
 * JSON payloads from `data:` SSE lines. Comments/empty lines are skipped.
 * Malformed JSON events are logged to console.warn and skipped.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @yields {object} parsed event payload
 */
export async function* parseSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            yield JSON.parse(payload);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[parseSSE] malformed JSON, skipping:', payload);
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export default parseSSE;
