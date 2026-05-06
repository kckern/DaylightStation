// frontend/src/modules/Health/CoachChat/index.jsx
import { AgentChatSurface } from '../../Agent/AgentChatSurface.jsx';
import { MENTION_CATEGORIES, buildAttachment } from './mentions/index.js';

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
export function CoachChat({ userId, variant = 'light', style }) {
  const mentions = userId
    ? {
        fetchUrl: `/api/v1/health/mentions/all?user=${encodeURIComponent(userId)}`,
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
    />
  );
}

export default CoachChat;
