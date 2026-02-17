const WALL_THRESHOLD = 500;
const CHUNK_TARGET = 450;
const SENTENCE_RE = /(?<=[.!?])\s+(?=[A-Z"'\u201C\u2018])/;

function splitWallOfText(text) {
  const sentences = text.split(SENTENCE_RE);
  const chunks = [];
  let current = [];
  let len = 0;
  for (const s of sentences) {
    current.push(s);
    len += s.length;
    if (len >= CHUNK_TARGET) {
      chunks.push(current.join(' '));
      current = [];
      len = 0;
    }
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}

function textToParagraphs(text) {
  const raw = text.split(/\n{2,}/);
  const paragraphs = [];
  for (const block of raw) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length > WALL_THRESHOLD && !trimmed.includes('\n')) {
      paragraphs.push(...splitWallOfText(trimmed));
    } else {
      paragraphs.push(trimmed);
    }
  }
  return paragraphs;
}

function renderParagraph(text, key) {
  const lines = text.split('\n');
  return (
    <p key={key} style={{ margin: '0 0 0.75em 0' }}>
      {lines.map((line, i) => (
        i === 0 ? line : <span key={i}><br />{line}</span>
      ))}
    </p>
  );
}

export default function BodySection({ data }) {
  if (!data?.text) return null;
  const paragraphs = textToParagraphs(data.text);
  return (
    <div style={{ fontSize: '0.9rem', color: '#c1c2c5', lineHeight: 1.6 }}>
      {paragraphs.map((p, i) => renderParagraph(p, i))}
    </div>
  );
}
