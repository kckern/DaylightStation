import { useState, useEffect, useRef, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export default function ContentDrawer({ item, onClose }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const drawerRef = useRef(null);

  const isReddit = item?.source === 'reddit';
  const postId = item?.meta?.postId;

  useEffect(() => {
    if (!item) return;
    setLoading(true);
    setContent(null);

    const fetchContent = async () => {
      try {
        if (isReddit && postId) {
          const res = await fetch(`https://www.reddit.com/comments/${postId}.json`, {
            headers: { 'Accept': 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            const comments = data?.[1]?.data?.children || [];
            setContent({
              type: 'comments',
              items: comments
                .filter(c => c.kind === 't1')
                .slice(0, 8)
                .map(c => ({
                  author: c.data.author,
                  body: c.data.body?.slice(0, 300),
                  score: c.data.score,
                })),
            });
          }
        } else if (item.link) {
          const result = await DaylightAPI(`/api/v1/feed/readable?url=${encodeURIComponent(item.link)}`);
          if (result?.content) {
            setContent({ type: 'article', text: result.content, title: result.title });
          }
        }
      } catch (err) {
        console.error('ContentDrawer fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [item, isReddit, postId]);

  // Animate slide-down on mount
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    el.animate(
      [{ maxHeight: '0px', opacity: 0 }, { maxHeight: '600px', opacity: 1 }],
      { duration: 250, easing: 'ease-out', fill: 'forwards' }
    );
  }, [item]);

  const handleClose = useCallback(() => {
    const el = drawerRef.current;
    if (!el) { onClose(); return; }
    const anim = el.animate(
      [{ maxHeight: '600px', opacity: 1 }, { maxHeight: '0px', opacity: 0 }],
      { duration: 200, easing: 'ease-in', fill: 'forwards' }
    );
    anim.onfinish = onClose;
  }, [onClose]);

  if (!item) return null;

  return (
    <div
      ref={drawerRef}
      style={{
        overflow: 'hidden',
        maxHeight: 0,
        background: '#1a1b1e',
        borderRadius: '0 0 12px 12px',
        marginTop: '-12px',
        paddingTop: '12px',
        position: 'relative',
      }}
    >
      <button
        onClick={handleClose}
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          background: 'none',
          border: 'none',
          color: '#868e96',
          fontSize: '1.2rem',
          cursor: 'pointer',
          padding: '0.25rem',
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        &times;
      </button>

      <div style={{ padding: '0.75rem 1rem', maxHeight: '500px', overflowY: 'auto' }}>
        {loading && (
          <p style={{ color: '#5c636a', fontSize: '0.8rem' }}>Loading...</p>
        )}

        {!loading && content?.type === 'comments' && (
          <div>
            {content.items.map((c, i) => (
              <div key={i} style={{
                padding: '0.5rem 0',
                borderBottom: '1px solid #2c2e33',
              }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#228be6' }}>
                    {c.author}
                  </span>
                  {c.score != null && (
                    <span style={{ fontSize: '0.65rem', color: '#5c636a' }}>
                      {c.score} pts
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#c1c2c5', lineHeight: 1.4 }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {!loading && content?.type === 'article' && (
          <div style={{ fontSize: '0.85rem', color: '#c1c2c5', lineHeight: 1.6 }}>
            {content.text.slice(0, 1500)}
            {content.text.length > 1500 && (
              <span style={{ color: '#5c636a' }}> ...</span>
            )}
          </div>
        )}

        {!loading && !content && (
          <p style={{ color: '#5c636a', fontSize: '0.8rem' }}>No preview available</p>
        )}
      </div>
    </div>
  );
}
