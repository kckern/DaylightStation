import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

function buildPath(path, { modifiers = {} }) {
  const clean = String(path).replace(/^\/|\/$/g, '');
  const segs = [clean];
  if (modifiers.playable) segs.push('playable');
  if (modifiers.shuffle) segs.push('shuffle');
  if (modifiers.recent_on_top) segs.push('recent_on_top');
  return `api/v1/list/${segs.join('/')}`;
}

export function useListBrowse(path, { modifiers = {}, take = 50 } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);
  const baseRef = useRef('');

  useEffect(() => {
    const base = buildPath(path, { modifiers });
    baseRef.current = base;
    skipRef.current = 0;
    setItems([]);
    setLoading(true);
    setError(null);

    let cancelled = false;
    DaylightAPI(`${base}?take=${take}`)
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
        setTotal(typeof res?.total === 'number' ? res.total : 0);
        skipRef.current = Array.isArray(res?.items) ? res.items.length : 0;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, take, modifiers.playable, modifiers.shuffle, modifiers.recent_on_top]);

  const loadMore = useCallback(async () => {
    const url = `${baseRef.current}?take=${take}&skip=${skipRef.current}`;
    try {
      const res = await DaylightAPI(url);
      setItems((prev) => prev.concat(Array.isArray(res?.items) ? res.items : []));
      skipRef.current += Array.isArray(res?.items) ? res.items.length : 0;
    } catch (err) {
      setError(err);
    }
  }, [take]);

  return { items, total, loading, error, loadMore };
}

export default useListBrowse;
