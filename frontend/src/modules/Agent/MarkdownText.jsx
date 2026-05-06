// frontend/src/modules/Health/CoachChat/MarkdownText.jsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render markdown for assistant chat messages. GFM-flavored (tables,
 * strikethrough, autolinks). HTML is sandboxed by react-markdown.
 *
 * Streaming-safe: re-parses on every text prop change. Partial markdown
 * (e.g. "**hi" mid-stream) renders as literal text until the closing
 * delimiter arrives.
 *
 * @param {{ text: string }} props
 */
export function MarkdownText({ text }) {
  return (
    <div className="coach-chat__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="coach-chat__md-p">{children}</p>,
          ul: ({ children }) => <ul className="coach-chat__md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="coach-chat__md-ol">{children}</ol>,
          li: ({ children }) => <li className="coach-chat__md-li">{children}</li>,
          // v10 API: no `inline` prop — detect inline code by absence of language className
          code: ({ className, children, node, ...rest }) =>
            /language-(\w+)/.exec(className || '')
              ? <pre className="coach-chat__md-code-block"><code className={className} {...rest}>{children}</code></pre>
              : <code className="coach-chat__md-code-inline" {...rest}>{children}</code>,
          table: ({ children }) => <table className="coach-chat__md-table">{children}</table>,
          strong: ({ children }) => <strong className="coach-chat__md-strong">{children}</strong>,
          em: ({ children }) => <em className="coach-chat__md-em">{children}</em>,
        }}
      >
        {text || ''}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownText;
