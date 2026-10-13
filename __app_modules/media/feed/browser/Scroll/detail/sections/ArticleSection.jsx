import DOMPurify from 'dompurify';

export default function ArticleSection({ data }) {
  if (!data?.html) return null;
  return (
    <div
      className="detail-article"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(data.html || '') }}
    />
  );
}
