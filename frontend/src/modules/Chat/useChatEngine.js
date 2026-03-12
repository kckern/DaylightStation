import { useState, useCallback, useRef, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Generic chat engine hook for agent conversations.
 *
 * @param {Object} opts
 * @param {string} opts.agentId - Agent identifier
 * @param {Function} [opts.onAction] - Handler for action button clicks
 * @param {string} [opts.userId] - User identifier
 */
export function useChatEngine({ agentId, onAction, userId = 'default' }) {
  const logger = useMemo(() => getLogger().child({ component: 'chat-engine' }), []);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const send = useCallback(async (text) => {
    if (!text.trim()) return;

    const userMsg = { role: 'user', content: text, type: 'text', timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, context: { userId } }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Agent error: ${res.status}`);
      const data = await res.json();

      const assistantMsg = parseAgentResponse(data);
      setMessages(prev => [...prev, assistantMsg]);
      logger.info('chat.response', { agentId, msgLength: data.output?.length });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        logger.error('chat.error', { agentId, error: err.message });
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, userId, logger]);

  const handleAction = useCallback((action, data) => {
    logger.info('chat.action', { agentId, action });
    onAction?.(action, data);
  }, [agentId, onAction, logger]);

  const clear = useCallback(() => setMessages([]), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return { messages, loading, error, send, handleAction, clear, cancel };
}

function parseAgentResponse(data) {
  const base = {
    role: 'assistant',
    content: data.output || '',
    timestamp: new Date().toISOString(),
  };

  // Try to detect structured responses (proposals, actions)
  try {
    const parsed = JSON.parse(data.output);
    if (parsed.change && parsed.reasoning) {
      return { ...base, type: 'proposal', proposal: parsed };
    }
    if (parsed.message && parsed.actions) {
      return { ...base, type: 'action', content: parsed.message, actions: parsed.actions };
    }
  } catch {
    // Not JSON — plain text response
  }

  return { ...base, type: 'text' };
}
