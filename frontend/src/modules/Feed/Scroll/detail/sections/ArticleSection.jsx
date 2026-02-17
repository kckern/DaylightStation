export default function ArticleSection({ data }) {
  if (!data?.html) return null;
  return (
    <div
      style={{ fontSize: '0.9rem', color: '#c1c2c5', lineHeight: 1.7 }}
      dangerouslySetInnerHTML={{ __html: data.html }}
    />
  );
}
