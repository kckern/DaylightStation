/**
 * filterMode — decides whether the content filter fetches and runs for a title.
 * Default: on when the API says the title is certified (`certification.ready`).
 * `?filter=0` forces off, `?filter=1` forces on (provisional EDLs allowed).
 */
export function filterMode({ search = '', certification = null, status = 'idle' } = {}) {
  const flag = new URLSearchParams(search || '').get('filter');
  if (flag === '0') return { fetch: false, enabled: false, reason: 'forced-off' };
  if (status === 'none') return { fetch: true, enabled: false, reason: 'no-data' };
  if (status === 'idle' || status === 'loading') return { fetch: true, enabled: false, reason: 'loading' };
  if (status === 'failed') return { fetch: true, enabled: flag === '1', reason: flag === '1' ? 'forced-on' : 'uncertified' };
  if (flag === '1') return { fetch: true, enabled: true, reason: 'forced-on' };
  return certification?.ready === true
    ? { fetch: true, enabled: true, reason: 'certified' }
    : { fetch: true, enabled: false, reason: 'uncertified' };
}
