import { formatPhotoDate } from '../utils.js';

export default function PhotoBody({ item }) {
  const location = item.body || item.meta?.location || null;
  const photoDate = formatPhotoDate(item.meta?.originalDate);
  const heading = location || item.title;
  const desc = photoDate;

  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 600,
        color: '#fff',
        lineHeight: 1.3,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {heading}
      </h3>
      {desc && (
        <p style={{
          margin: '0.3rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          lineHeight: 1.35,
        }}>
          {desc}
        </p>
      )}
    </>
  );
}
