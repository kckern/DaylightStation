// frontend/src/modules/Health/CoachChat/index.jsx
import { FALLBACK_SUGGEST_ENDPOINT, MENTION_CATEGORIES, buildAttachment } from "./mentions/vocabulary.config.js";
import { AgentChatSurface } from "../../../../../__capabilities/agent-runtime/browser/chat.mjs";

/**
 * Health-coach chat surface — thin wrapper around <AgentChatSurface> that
 * supplies health-specific mention configuration (period/day/metric
 * categories, fetched from /api/v1/health/mentions/all).
 *
 * Public API preserved for HealthApp.jsx:
 *   import CoachChat from '../modules/Health/CoachChat';
 *   <CoachChat userId={userId} variant="overlay" />
 *
 * @param {{ userId: string, variant?: 'light'|'overlay', style?: object }} props
 */
export function CoachChat({ userId, variant = 'light', style, conversation }) {
  const mentions = userId
    ? {
        fetchUrl: `${FALLBACK_SUGGEST_ENDPOINT}?user=${encodeURIComponent(userId)}`,
        categories: MENTION_CATEGORIES,
        buildAttachment,
      }
    : undefined;

  return (
    <AgentChatSurface
      agentId="health-coach"
      userId={userId}
      variant={variant}
      style={style}
      mentions={mentions}
      conversation={conversation}
      starterPrompts={['Review my recent food log', 'Help me adjust a portion', 'Explain my weight trend']}
    />
  );
}

export default CoachChat;
