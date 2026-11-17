import { useEffect } from 'react';

// Evidence only. Never send identity, grants, answers, URLs, or learning commands.
export function startPortalPageHeartbeat({ fetch = globalThis.fetch, document = globalThis.document,
  build = import.meta.env?.VITE_BUILD_ID || 'dev', activityId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` } = {}) {
  let seq=0, request, timeout;
  const beat=() => {
    request?.abort(); clearTimeout(timeout);
    request=new AbortController();
    timeout=setTimeout(() => request.abort(), 2000);
    Promise.resolve().then(() => fetch('http://127.0.0.1:8773/page/beat', {
      method:'POST', credentials:'omit', redirect:'error', cache:'no-store',
      headers:{'Content-Type':'application/json'}, signal:request.signal,
      body:JSON.stringify({protocol:1,build,visible:document.visibilityState==='visible',activityId,seq:++seq}),
    })).catch(() => {}); // Native evidence remains stale on transport failure.
  };
  beat(); const interval=setInterval(beat,5000);
  return () => { clearInterval(interval); clearTimeout(timeout); request?.abort(); };
}

export function usePortalPageHeartbeat(pathname) {
  const enabled=/^\/screens?\/portal(?:\/|$)/.test(pathname) && typeof window.fully!=='undefined';
  useEffect(() => enabled ? startPortalPageHeartbeat() : undefined, [enabled]);
}
