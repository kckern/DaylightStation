export default function CommentsSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div>
      {data.items.map((c, i) => (
        <div key={i} style={{
          padding: '0.5rem 0',
          borderBottom: '1px solid var(--feed-border)',
          marginLeft: `${Math.min(c.depth || 0, 3) * 12}px`,
        }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--feed-accent-strong)' }}>{c.author}</span>
            {c.score != null && (
              <span style={{ fontSize: '0.65rem', color: 'var(--feed-text-2)' }}>{c.score} pts</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--feed-text-1)', lineHeight: 1, whiteSpace: 'pre-wrap' }}>
            {c.body}
          </p>
        </div>
      ))}
    </div>
  );
}
