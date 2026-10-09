// frontend/src/modules/Feed/contentPlugins/youtube.jsx
// =========================================================================
// Scroll Body (masonry card)
// =========================================================================

// Strip leading emoji / symbol characters from body text
function stripLeadingEmoji(text) {
  if (!text) return text;
  // ZWJ (\u200d) and VS16 (\ufe0f) are kept as alternation, not in the class,
  // to avoid misleading-character-class (they combine with adjacent glyphs).
  return text.replace(/^(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]|\u200d|\ufe0f)+/u, '');
}

export function YouTubeScrollBody({ item }) {
  const body = stripLeadingEmoji(item.body);

  return (
    <>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        wordBreak: 'break-word',
      }}>
        {item.title}
      </h3>
      {body && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {body}
        </p>
      )}
    </>
  );
}

