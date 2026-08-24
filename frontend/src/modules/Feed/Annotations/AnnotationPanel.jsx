import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import {
  cacheAnnotations,
  cachedAnnotations,
  flushAnnotationMutations,
  offlineAnnotationId,
  queueAnnotationMutation,
  queuedAnnotationCount,
} from '../offline/annotationOfflineStore.js';
import './AnnotationPanel.scss';

const log = getLogger().child({ app: 'feed', module: 'annotations' });

function isNetworkFailure(error) {
  return navigator.onLine === false || error?.name === 'TypeError' || /failed to fetch|network/i.test(error?.message || '');
}

function selectionLocator(selection, scope) {
  if (!selection?.rangeCount || !scope) return null;
  const range = selection.getRangeAt(0);
  if (!scope.contains(range.commonAncestorContainer)) return null;
  const exact = selection.toString().trim().slice(0, 5000);
  if (!exact) return null;
  const scopeText = scope.textContent || '';
  const offset = scopeText.indexOf(exact);
  return JSON.stringify({
    type: 'TextQuoteSelector',
    exact,
    prefix: offset >= 0 ? scopeText.slice(Math.max(0, offset - 32), offset) : '',
    suffix: offset >= 0 ? scopeText.slice(offset + exact.length, offset + exact.length + 32) : '',
  });
}

function revealLocator(locator, scope) {
  if (!locator || !scope) return false;
  let selector;
  try { selector = JSON.parse(locator); } catch { return false; }
  if (selector?.type !== 'TextQuoteSelector' || !selector.exact) return false;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('.feed-annotations') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  let text = '';
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: text.length });
    text += walker.currentNode.nodeValue || '';
  }
  let match = text.indexOf(selector.exact);
  if (match < 0) return false;
  if (selector.prefix) {
    const contextual = `${selector.prefix}${selector.exact}${selector.suffix || ''}`;
    const contextualMatch = text.indexOf(contextual);
    if (contextualMatch >= 0) match = contextualMatch + selector.prefix.length;
  }
  const end = match + selector.exact.length;
  const startEntry = [...nodes].reverse().find(entry => entry.start <= match);
  const endEntry = [...nodes].reverse().find(entry => entry.start < end);
  if (!startEntry || !endEntry) return false;
  const range = document.createRange();
  range.setStart(startEntry.node, match - startEntry.start);
  range.setEnd(endEntry.node, Math.min((endEntry.node.nodeValue || '').length, end - endEntry.start));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  startEntry.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

export default function AnnotationPanel({ item }) {
  const [annotations, setAnnotations] = useState([]);
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState('');
  const [locator, setLocator] = useState(null);
  const [color, setColor] = useState('yellow');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(queuedAnnotationCount);
  const noteRef = useRef(null);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    if (!item?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/feed/annotations?itemId=${encodeURIComponent(item.id)}`);
      const next = result.annotations || [];
      setAnnotations(next);
      cacheAnnotations(item.id, next);
      setOffline(false);
    } catch (loadError) {
      log.warn('feed.annotations.load_failed', { itemId: item.id, error: loadError.message });
      const cached = cachedAnnotations(item.id);
      if (cached.length || isNetworkFailure(loadError)) {
        setAnnotations(cached);
        setOffline(true);
      } else setError('Notes could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [item?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let active = true;
    const replay = async () => {
      if (navigator.onLine === false) return;
      const completed = await flushAnnotationMutations(DaylightAPI);
      if (!active) return;
      setPending(queuedAnnotationCount());
      if (completed) load();
    };
    window.addEventListener('online', replay);
    replay();
    return () => { active = false; window.removeEventListener('online', replay); };
  }, [load]);

  const commit = useCallback((updater) => {
    setAnnotations(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      cacheAnnotations(item.id, next);
      return next;
    });
  }, [item.id]);

  const queue = useCallback((method, path, data) => {
    queueAnnotationMutation({ queueId: offlineAnnotationId(), method, path, data, createdAt: new Date().toISOString() });
    setPending(queuedAnnotationCount());
    setOffline(true);
  }, []);

  const captureSelection = () => {
    const selection = window.getSelection?.();
    const scope = panelRef.current?.closest('.article-expanded, .detail-view') || panelRef.current?.parentElement;
    const selected = selection?.toString().trim().slice(0, 5000) || '';
    if (!selected) {
      setError('Select text in the article first.');
      return;
    }
    const nextLocator = selectionLocator(selection, scope);
    if (!nextLocator) {
      setError('Select text from this article first.');
      return;
    }
    setQuote(selected);
    setLocator(nextLocator);
    setError(null);
    noteRef.current?.focus();
  };

  const create = async event => {
    event.preventDefault();
    if (!note.trim() && !quote.trim()) return;
    setSaving(true);
    setError(null);
    const id = offlineAnnotationId();
    const values = { id, itemId: item.id, note, quote, color, locator };
    try {
      const result = await DaylightAPI('/api/v1/feed/annotations', values, 'POST');
      commit(current => [...current, result.annotation]);
      setNote('');
      setQuote('');
      setLocator(null);
    } catch (saveError) {
      log.warn('feed.annotations.create_failed', { itemId: item.id, error: saveError.message });
      if (isNetworkFailure(saveError)) {
        const now = new Date().toISOString();
        commit(current => [...current, { ...values, stateKey: item.stateKey, createdAt: now, updatedAt: now, syncStatus: 'pending' }]);
        queue('POST', '/api/v1/feed/annotations', values);
        setNote('');
        setQuote('');
        setLocator(null);
      } else setError('The note was not saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const update = async (annotation, values) => {
    try {
      const result = await DaylightAPI(`/api/v1/feed/annotations/${encodeURIComponent(annotation.id)}`, values, 'PATCH');
      commit(current => current.map(value => value.id === annotation.id ? result.annotation : value));
      return true;
    } catch (updateError) {
      log.warn('feed.annotations.update_failed', { annotationId: annotation.id, error: updateError.message });
      if (isNetworkFailure(updateError)) {
        const optimistic = { ...annotation, ...values, updatedAt: new Date().toISOString(), syncStatus: 'pending' };
        commit(current => current.map(value => value.id === annotation.id ? optimistic : value));
        queue('PATCH', `/api/v1/feed/annotations/${encodeURIComponent(annotation.id)}`, values);
        return true;
      }
      setError('The note was not updated.');
      return false;
    }
  };

  const remove = async annotation => {
    try {
      await DaylightAPI(`/api/v1/feed/annotations/${encodeURIComponent(annotation.id)}`, {}, 'DELETE');
      commit(current => current.filter(value => value.id !== annotation.id));
    } catch (deleteError) {
      log.warn('feed.annotations.delete_failed', { annotationId: annotation.id, error: deleteError.message });
      if (isNetworkFailure(deleteError)) {
        commit(current => current.filter(value => value.id !== annotation.id));
        queue('DELETE', `/api/v1/feed/annotations/${encodeURIComponent(annotation.id)}`, {});
      } else setError('The note was not deleted.');
    }
  };

  const reveal = annotation => {
    const scope = panelRef.current?.closest('.article-expanded, .detail-view') || panelRef.current?.parentElement;
    if (!revealLocator(annotation.locator, scope)) setError('The quoted text is not present in this version of the article.');
    else setError(null);
  };

  return (
    <section ref={panelRef} className="feed-annotations" aria-labelledby={`annotations-${encodeURIComponent(item.id)}`}>
      <div className="feed-annotations__heading">
        <h3 id={`annotations-${encodeURIComponent(item.id)}`}>Notes &amp; highlights</h3>
        <button type="button" onClick={captureSelection}>Use selected text</button>
      </div>
      {(offline || pending > 0) && <p className="feed-annotations__status" role="status">{pending > 0 ? `${pending} note change${pending === 1 ? '' : 's'} waiting to sync.` : 'Showing notes saved on this device.'}</p>}
      {loading ? <p className="feed-annotations__status" role="status">Loading notes…</p> : (
        <>
          {annotations.map(annotation => <AnnotationRow key={annotation.id} annotation={annotation} onUpdate={update} onDelete={remove} onReveal={reveal} />)}
          <form onSubmit={create} className="feed-annotations__form">
            {quote && <blockquote className={`feed-annotation-quote feed-annotation-quote--${color}`}>{quote}<button type="button" aria-label="Remove selected quote" onClick={() => { setQuote(''); setLocator(null); }}>×</button></blockquote>}
            <label>
              <span>Add a note</span>
              <textarea ref={noteRef} value={note} maxLength={10000} rows={3} onChange={event => setNote(event.target.value)} placeholder="What do you want to remember?" />
            </label>
            <div className="feed-annotations__form-actions">
              <label>Highlight <select value={color} onChange={event => setColor(event.target.value)}><option value="yellow">Yellow</option><option value="blue">Blue</option><option value="green">Green</option><option value="pink">Pink</option><option value="none">None</option></select></label>
              <button type="submit" disabled={saving || (!note.trim() && !quote.trim())}>{saving ? 'Saving…' : 'Save note'}</button>
            </div>
          </form>
        </>
      )}
      {error && <p className="feed-annotations__error" role="alert">{error} <button type="button" onClick={load}>Retry</button></p>}
    </section>
  );
}

function AnnotationRow({ annotation, onUpdate, onDelete, onReveal }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(annotation.note || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    if (await onUpdate(annotation, { note, quote: annotation.quote, color: annotation.color, locator: annotation.locator })) setEditing(false);
    setSaving(false);
  };

  return (
    <article className="feed-annotation">
      {annotation.quote && <blockquote className={`feed-annotation-quote feed-annotation-quote--${annotation.color}`}>{annotation.quote}</blockquote>}
      {editing ? <textarea aria-label="Edit note" value={note} maxLength={10000} rows={3} onChange={event => setNote(event.target.value)} /> : annotation.note && <p>{annotation.note}</p>}
      <div className="feed-annotation__meta">
        <time dateTime={annotation.updatedAt}>{new Date(annotation.updatedAt).toLocaleString()}</time>
        {annotation.locator && <button type="button" onClick={() => onReveal(annotation)}>Find highlight</button>}
        {editing ? <><button type="button" onClick={save} disabled={saving || (!note.trim() && !annotation.quote)}>{saving ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { setNote(annotation.note || ''); setEditing(false); }}>Cancel</button></> : <button type="button" onClick={() => setEditing(true)}>Edit</button>}
        <button type="button" onClick={() => onDelete(annotation)}>Delete</button>
      </div>
    </article>
  );
}
