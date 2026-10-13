/**
 * Turn a goals-save failure into a sentence a person can act on.
 *
 * `DaylightAPI` throws `Error("HTTP 400: Bad Request - {json body}")` — the
 * whole response body, verbatim, inside the message string. Rendering that
 * directly showed the goals form a line of raw JSON. The fix belongs here, at
 * the one consumer that knows what these codes mean, not in the shared fetch
 * helper every other caller depends on.
 */
export function goalSaveMessage(error) {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace));
      if (typeof body?.error === 'string' && body.error) {
        // Server messages read "CODE: what is wrong" — the code is already
        // carried in `body.code`, so only the explanation is worth showing.
        const marker = body.error.indexOf(': ');
        const detail = marker >= 0 ? body.error.slice(marker + 2) : body.error;
        if (body.code === 'GOALS_INVALID') return `Those goals weren't saved — ${detail}.`;
        return detail;
      }
    } catch {
      // Not JSON after all; fall through to the raw message.
    }
  }
  return raw || 'Something went wrong saving your goals.';
}
export default goalSaveMessage;
