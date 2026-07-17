import { AgentChatSurface } from '../../../Agent/AgentChatSurface.jsx';

/**
 * Lifeplan-guide chat surface — thin wrapper around <AgentChatSurface>.
 *
 * The previous implementation used `Chat/ChatPanel` (which was broken — wrong
 * URL prefix `/api/agents/...` instead of `/api/v1/agents/...`). This wrapper
 * uses the shared agent chat surface, which goes through the working URL.
 *
 * Lifeplan-guide has no mention configuration — the popover is omitted.
 * The previous accept-proposal/start-ceremony/snooze action handlers and
 * thumbs-up/down feedback handlers were dropped because they all posted to
 * the broken URL and never functioned in production. Re-add as a follow-up
 * feature on AgentChatSurface if needed.
 */
export default function CoachChat({ userId }) {
  return (
    <AgentChatSurface
      agentId="lifeplan-guide"
      userId={userId || 'default'}
      style={{ height: 'calc(100vh - var(--app-shell-header-height, 48px) - var(--app-shell-padding, 16px) * 2)' }}
    />
  );
}
