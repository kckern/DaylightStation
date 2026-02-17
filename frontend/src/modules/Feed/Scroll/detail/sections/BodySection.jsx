export default function BodySection({ data }) {
  if (!data?.text) return null;
  return (
    <div style={{ fontSize: '0.9rem', color: '#c1c2c5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {data.text}
    </div>
  );
}
