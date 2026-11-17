/** Map a retained content return target to an existing screen landing URL. */
export function contentReturnUrl(target, pathname) {
  if (!target || target.kind !== 'content' || typeof target.content_id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_./:-]*$/.test(target.content_id) || /^(?:https?|javascript|data|file|ftp|wss?):/i.test(target.content_id) || Object.keys(target).some(key => !['kind','content_id','item_uid'].includes(key))) return null;
  if (target.item_uid !== undefined && (typeof target.item_uid !== 'string' || !target.item_uid)) return null;
  const base = String(pathname || '').match(/^(\/screens?\/[^/]+)/)?.[1] || '/tv';
  const params = new URLSearchParams({list:target.content_id});
  if (target.item_uid) params.set('focus_uid',target.item_uid);
  return `${base}?${params}`;
}

/** Parse focus as navigation state; content authorization remains server-owned. */
export function focusUidFromSearch(search) {
  const value = new URLSearchParams(search || '').get('focus_uid');
  return value || null;
}
