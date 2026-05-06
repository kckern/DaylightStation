import { useState } from 'react';
import { AiMark } from '../AiMark/index.jsx';

export function ToolCallAttribution({ toolCalls }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls?.length) return null;

  return (
    <div className="tool-call-attribution">
      <button
        className="tool-call-attribution__toggle"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        {toolCalls.map((tc, i) => (
          <span key={i} className="tool-call-attribution__row">
            <AiMark size={16} />
            {tc.status === 'running'
              ? <span>using <code>{tc.toolName}</code> · running…</span>
              : <span>used <code>{tc.toolName}</code> · {tc.latencyMs}ms</span>
            }
          </span>
        ))}
      </button>
      {expanded && (
        <pre className="tool-call-attribution__details">
          {JSON.stringify(toolCalls, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default ToolCallAttribution;
