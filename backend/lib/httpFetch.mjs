import nodeFetch from 'node-fetch';

function pickMsg(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data === 'object') {
    return data.message || data.error || data.error_message || data.description || JSON.stringify(data);
  }
  return '';
}

export default async function fetchWithLog(input, init = {}) {
  const start = Date.now();
  const method = (init.method || 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : (input?.url || '');

  let res;
  try {
    res = await nodeFetch(input, init);
  } catch (err) {
    const line = `${method} ${url} -> NETWORK (${Date.now() - start}ms) - ${err.message}`;
    console.error(`[HTTP] ${line}`);
    err.shortMessage = line;
    throw err;
  }

  if (!res.ok) {
    // Try to read a short body snippet safely without consuming for caller if needed
    let msg = '';
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.clone().json();
        msg = pickMsg(data);
      } else {
        const text = await res.clone().text();
        msg = (text || '').replace(/\s+/g, ' ').slice(0, 200);
      }
    } catch (_) { /* ignore body read errors */ }

    const rid = res.headers.get('x-request-id') || res.headers.get('x-correlation-id');
    const line = `${method} ${url} -> ${res.status} ${res.statusText} (${Date.now() - start}ms)${msg ? ' - ' + msg : ''}${rid ? ' (req id: ' + rid + ')' : ''}`;
    console.error(`[HTTP] ${line}`);

    const error = new Error(line);
    error.shortMessage = line;
    error.status = res.status;
    error.url = url;
    error.response = res;

    // Do not throw by default to avoid breaking existing logic that parses JSON for error fields
    if (init.throwOnHTTPError) throw error;
  }

  return res;
}
