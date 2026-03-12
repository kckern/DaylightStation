import { useCallback, useMemo } from 'react';
import { ChatPanel } from '../../../Chat';
import getLogger from '../../../../lib/logging/Logger.js';

export default function CoachChat() {
  const logger = useMemo(() => getLogger().child({ component: 'coach-chat' }), []);

  const handleAction = useCallback((action, data) => {
    logger.info('coach.action', { action, data });

    switch (action) {
      case 'accept_proposal':
        logger.info('coach.accept_proposal', { change: data?.change });
        break;
      case 'start_ceremony':
        logger.info('coach.start_ceremony', { type: data?.type });
        break;
      case 'snooze':
        logger.info('coach.snooze', { hours: data?.hours });
        break;
      default:
        logger.debug('coach.unhandled_action', { action });
    }
  }, [logger]);

  const handleFeedback = useCallback((rating, context) => {
    logger.info('coach.feedback', { rating, context: context?.slice(0, 100) });
    fetch('/api/agents/lifeplan-guide/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: `[FEEDBACK] Rating: ${rating}. Context: ${context}`,
        context: { userId: 'default' },
      }),
    }).catch(err => logger.warn('coach.feedback-error', { error: err.message }));
  }, [logger]);

  return (
    <ChatPanel
      agentId="lifeplan-guide"
      onAction={handleAction}
      onFeedback={handleFeedback}
      placeholder="Ask your life coach..."
      style={{ height: 'calc(100vh - 60px)' }}
    />
  );
}
