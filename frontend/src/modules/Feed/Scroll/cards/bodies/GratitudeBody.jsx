export default function GratitudeBody({ item }) {
  return (
    <p style={{
      margin: 0,
      fontSize: '0.95rem',
      fontStyle: 'italic',
      color: '#fff3bf',
      lineHeight: 1.5,
      wordBreak: 'break-word',
    }}>
      {item.body || item.title}
    </p>
  );
}
