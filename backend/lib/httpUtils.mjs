export function buildCurl({ method = 'GET', url, headers = {}, data }) {
  const m = (method || 'GET').toUpperCase();
  const headerFlags = Object.entries(headers)
    .filter(([k, v]) => v != null && v !== '')
    .map(([k, v]) => `-H ${quote(`${k}: ${v}`)}`)
    .join(' ');

  const dataFlag = data != null
    ? `-d ${quote(typeof data === 'string' ? data : JSON.stringify(data))}`
    : '';

  const parts = [
    'curl',
    '-s',
    `-X ${m}`,
    headerFlags,
    dataFlag,
    quote(url)
  ].filter(Boolean);

  return parts.join(' ');
}

function quote(str) {
  // Simple single-quote escape for POSIX sh
  if (str == null) return "''";
  const s = String(str);
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

export default { buildCurl };
