import DefaultBody from './DefaultBody.jsx';

export default function RedditBody({ item }) {
  return (
    <>
      <DefaultBody item={item} />
      {(item.meta?.score != null || item.meta?.numComments != null) && (
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginTop: '0.5rem',
          fontSize: '0.7rem',
          color: '#868e96',
        }}>
          {item.meta?.score != null && (
            <span>{item.meta.score.toLocaleString()} pts</span>
          )}
          {item.meta?.numComments != null && (
            <span>{item.meta.numComments} comments</span>
          )}
        </div>
      )}
    </>
  );
}
