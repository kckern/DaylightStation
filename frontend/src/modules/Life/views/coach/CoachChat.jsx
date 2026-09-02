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
      // Container-relative, not viewport-relative: `--app-shell-*` were
      // Mantine AppShell vars that no longer exist (AppShell was deleted),
      // so this used to fall back to bare 100vh — taller than the pinned
      // .ds-chrome__main box, pushing the composer below the fold and
      // double-scrolling. `.coach-chat` (AgentChatSurface.scss) is already
      // `height:100%; display:flex; flex-direction:column` with an
      // internally-scrolling message viewport, exactly like Health's
      // CoachChat mount (Apps/HealthApp.jsx `style={{ height: '100%' }}`)
      // — `.life-app-root` (LifeApp.scss) provides the definite height this
      // resolves against, same as AppChrome's `__main` does for Health.
      style={{ height: '100%' }}
    />
  );
}
